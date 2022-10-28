package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"syscall"

	datatransfer "github.com/filecoin-project/go-data-transfer"
	dtimpl "github.com/filecoin-project/go-data-transfer/impl"
	dtnet "github.com/filecoin-project/go-data-transfer/network"
	gstransport "github.com/filecoin-project/go-data-transfer/transport/graphsync"
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
	"github.com/ipld/go-ipld-prime"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p-core/host"
	"github.com/libp2p/go-libp2p-core/peer"
	"github.com/libp2p/go-tcp-transport"
	websocket "github.com/libp2p/go-ws-transport"
	cbg "github.com/whyrusleeping/cbor-gen"
	"golang.org/x/xerrors"
)

type BasicVoucher struct {
	Data string
}

// Type satisfies registry.Entry
func (bv BasicVoucher) Type() datatransfer.TypeIdentifier {
	return "BasicVoucher"
}

var _ = xerrors.Errorf
var _ = cid.Undef
var _ = sort.Sort

var lengthBufFakeDTType = []byte{129}

func (t *BasicVoucher) MarshalCBOR(w io.Writer) error {
	if t == nil {
		_, err := w.Write(cbg.CborNull)
		return err
	}
	if _, err := w.Write(lengthBufFakeDTType); err != nil {
		return err
	}

	scratch := make([]byte, 9)

	// t.Data (string) (string)
	if len(t.Data) > cbg.MaxLength {
		return xerrors.Errorf("Value in field t.Data was too long")
	}

	if err := cbg.WriteMajorTypeHeaderBuf(scratch, w, cbg.MajTextString, uint64(len(t.Data))); err != nil {
		return err
	}
	if _, err := io.WriteString(w, string(t.Data)); err != nil {
		return err
	}
	return nil
}

func (t *BasicVoucher) UnmarshalCBOR(r io.Reader) error {
	*t = BasicVoucher{}

	br := cbg.GetPeeker(r)
	scratch := make([]byte, 8)

	maj, extra, err := cbg.CborReadHeaderBuf(br, scratch)
	if err != nil {
		return err
	}
	if maj != cbg.MajArray {
		return fmt.Errorf("cbor input should be of type array")
	}

	if extra != 1 {
		return fmt.Errorf("cbor input had wrong number of fields")
	}

	// t.Data (string) (string)

	{
		sval, err := cbg.ReadStringBuf(br, scratch)
		if err != nil {
			return err
		}

		t.Data = string(sval)
	}
	return nil
}

type Validator struct {
	result datatransfer.VoucherResult
}

// NewValidator returns a new instance of a data transfer validator
func NewValidator() *Validator {
	return &Validator{}
}

// ValidatePush returns a result for a push validation
func (sv *Validator) ValidatePush(
	isRestart bool,
	chid datatransfer.ChannelID,
	sender peer.ID,
	voucher datatransfer.Voucher,
	baseCid cid.Cid,
	selector ipld.Node) (datatransfer.VoucherResult, error) {
	return sv.result, nil
}

// ValidatePull returns a result for a pull validation
func (sv *Validator) ValidatePull(
	isRestart bool,
	chid datatransfer.ChannelID,
	receiver peer.ID,
	voucher datatransfer.Voucher,
	baseCid cid.Cid,
	selector ipld.Node) (datatransfer.VoucherResult, error) {
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
	err = dt.RegisterVoucherType(&BasicVoucher{}, validator)
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
