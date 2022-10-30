package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	datatransfer "github.com/filecoin-project/go-data-transfer/v2"
	dtimpl "github.com/filecoin-project/go-data-transfer/v2/impl"
	dtnet "github.com/filecoin-project/go-data-transfer/v2/network"
	gstransport "github.com/filecoin-project/go-data-transfer/v2/transport/graphsync"
	"github.com/ipfs/go-cid"
	"github.com/ipfs/go-datastore"
	"github.com/ipfs/go-datastore/namespace"
	badgerds "github.com/ipfs/go-ds-badger"
	"github.com/ipfs/go-graphsync"
	gsimpl "github.com/ipfs/go-graphsync/impl"
	gsnet "github.com/ipfs/go-graphsync/network"
	"github.com/ipfs/go-graphsync/storeutil"
	blockstore "github.com/ipfs/go-ipfs-blockstore"
	logging "github.com/ipfs/go-log/v2"
	"github.com/ipld/go-ipld-prime/datamodel"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	"github.com/libp2p/go-libp2p/p2p/transport/websocket"

	_ "github.com/ipld/go-ipld-prime/codec/raw"
)

type Validator struct {
	result datatransfer.ValidationResult
}

// NewValidator returns a new instance of a data transfer validator
func NewValidator() *Validator {
	return &Validator{
		result: datatransfer.ValidationResult{Accepted: true},
	}
}

// ValidatePush returns a result for a push validation
func (sv *Validator) ValidatePush(
	chid datatransfer.ChannelID,
	sender peer.ID,
	voucher datamodel.Node,
	baseCid cid.Cid,
	selector datamodel.Node) (datatransfer.ValidationResult, error) {
	return sv.result, nil
}

// ValidatePull returns a result for a pull validation
func (sv *Validator) ValidatePull(
	chid datatransfer.ChannelID,
	receiver peer.ID,
	voucher datamodel.Node,
	baseCid cid.Cid,
	selector datamodel.Node) (datatransfer.ValidationResult, error) {
	return sv.result, nil
}

func (sv *Validator) ValidateRestart(chid datatransfer.ChannelID, channelState datatransfer.ChannelState) (datatransfer.ValidationResult, error) {
	return sv.result, nil
}

// NewDataTransfer packages together all the things needed for a new manager to work
func NewDataTransfer(ctx context.Context, h host.Host, gs graphsync.GraphExchange, ds datastore.Batching) (datatransfer.Manager, error) {
	// Create a special key for persisting the datatransfer manager state
	dtDs := namespace.Wrap(ds, datastore.NewKey("datatransfer"))
	// Setup datatransfer network
	dtNet := dtnet.NewFromLibp2pHost(h)
	// Setup graphsync transport
	tp := gstransport.NewTransport(h.ID(), gs)
	// Build the manager
	dt, err := dtimpl.NewDataTransfer(dtDs, dtNet, tp)
	if err != nil {
		return nil, err
	}
	ready := make(chan error, 1)
	dt.OnReady(func(err error) {
		ready <- err
	})
	dt.Start(ctx)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case err := <-ready:
		return dt, err
	}
}

func run() error {
	lvl, err := logging.LevelFromString("debug")
	if err != nil {
		return err
	}
	logging.SetAllLoggers(lvl)

	path, err := os.MkdirTemp("", ".provider")
	if err != nil {
		return err
	}

	// Make our root repo dir and datastore dir
	err = os.MkdirAll(filepath.Join(path, "datastore"), 0755)
	if err != nil {
		return err
	}

	dsopts := badgerds.DefaultOptions
	dsopts.SyncWrites = false
	dsopts.Truncate = true

	ds, err := badgerds.NewDatastore(filepath.Join(path, "datastore"), &dsopts)
	if err != nil {
		return err
	}

	bs := blockstore.NewBlockstore(ds)

	host, err := libp2p.New(
		libp2p.ListenAddrStrings(
			"/ip4/0.0.0.0/tcp/41505",
			"/ip4/0.0.0.0/tcp/41506/ws",
		),
		// Explicitly declare transports
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Transport(websocket.New),
		libp2p.DisableRelay(),
	)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gs := gsimpl.New(ctx,
		gsnet.NewFromLibp2pHost(host),
		storeutil.LinkSystemForBlockstore(bs),
	)
	dt, err := NewDataTransfer(ctx, host, gs, ds)
	if err != nil {
		return err
	}

	validator := NewValidator()
	err = dt.RegisterVoucherType(datatransfer.TypeIdentifier("BasicVoucher"), validator)
	if err != nil {
		return err
	}

	dt.SubscribeToEvents(func(event datatransfer.Event, channelState datatransfer.ChannelState) {
		fmt.Println("==> ", datatransfer.Events[event.Code])
	})

	for _, a := range host.Addrs() {
		fmt.Printf("%s/p2p/%s\n", a, host.ID())
	}

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)

	signal.Ignore(syscall.SIGPIPE)
	select {
	case s := <-interrupt:
		fmt.Printf("\nShutting down, reason: %s\n", s.String())
	case <-ctx.Done():
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Println("error: ", err)
	}
}
