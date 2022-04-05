import type {HandlerProps, MuxedStream, Connection} from "libp2p";
import {Connection as Conn} from "libp2p-interfaces/src/connection";
import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {EventEmitter} from "events";
// @ts-ignore
import pair from "it-pair";
import type BufferList from "bl/BufferList";
import drain from "it-drain";
import {concat as concatUint8Arrays} from "uint8arrays/concat";

class MockAddressBook {
  addrs: {[key: string]: Multiaddr[]} = {};

  add(pid: PeerId, addrs: Multiaddr[]) {
    this.addrs[pid.toString()] = addrs;
    return this;
  }
}

export class MockLibp2p {
  streamId = 0;
  handlers: {[key: string]: (props: HandlerProps) => void} = {};

  peerId: PeerId;
  connectionManager = new EventEmitter();
  peerStore = {
    addressBook: new MockAddressBook(),
  };

  sources: {[key: string]: AsyncIterable<BufferList>} = {};

  openStreams: MuxedStream[] = [];

  constructor(peerId: PeerId) {
    this.peerId = peerId;
  }

  handle(protocol: string, handler: (props: HandlerProps) => void) {
    this.handlers[protocol] = handler;
  }

  unhandle(protocol: string | string[]) {
    const protos = Array.isArray(protocol) ? protocol : [protocol];
    protos.forEach((p) => {
      delete this.handlers[p];
    });
  }

  async dial(
    peer: string | PeerId | Multiaddr,
    options?: any
  ): Promise<Connection> {
    const localAddr = new Multiaddr("/ip4/127.0.0.1/tcp/8080");
    const remoteAddr = new Multiaddr("/ip4/127.0.0.1/tcp/8081");

    const [localPeer, remotePeer] = [
      PeerId.createFromB58String(
        "12D3KooWSoLzampfxc4t3sy9z7yq1Cgzbi7zGXpV7nvt5hfeKUhR"
      ),
      PeerId.createFromB58String(
        "12D3KooWSoLzampfxc4t3sy9z7yq1Cgzbi7zGXpV7nvt5hfeKRhU"
      ),
    ];
    const openStreams: MuxedStream[] = [];
    let streamId = 0;

    return new Conn({
      localPeer: localPeer,
      remotePeer: remotePeer,
      localAddr,
      remoteAddr,
      stat: {
        timeline: {
          open: Date.now() - 10,
          upgraded: Date.now(),
        },
        direction: "outbound",
        encryption: "/noise",
        multiplexer: "/mplex/6.7.0",
      },
      newStream: async (protocols) => {
        const id = streamId++;
        const stream = pair();

        stream.close = () => stream.sink([]);
        stream.id = id;

        openStreams.push(stream);

        return {
          stream,
          protocol: protocols[0],
        };
      },
      close: async () => {},
      getStreams: () => openStreams,
    });
  }

  async dialProtocol(
    peer: PeerId,
    protocols: string[] | string,
    options?: any
  ): Promise<{stream: MuxedStream; protocol: string}> {
    const id = "" + this.streamId++;
    const stream: MuxedStream =
      id in this.sources
        ? {
            source: this.sources[id],
            sink: drain,
          }
        : pair();
    stream.close = () => {};
    stream.id = id;

    this.openStreams.push(stream);

    const conn = {
      stream,
      protocol: typeof protocols === "string" ? protocols : protocols[0],
    };
    if (id in this.sources) {
      // @ts-ignore
      this.handlers[conn.protocol]({stream, connection: conn});
    }
    return conn;
  }
}

export async function concatChunkIterator(
  content: AsyncIterable<Uint8Array>
): Promise<Uint8Array> {
  const iterator = content[Symbol.asyncIterator]();
  let {value, done} = await iterator.next();
  let buf = value;
  while (!done) {
    ({value, done} = await iterator.next());
    if (value) {
      buf = concatUint8Arrays([buf, value], buf.length + value.length);
    }
  }
  return buf;
}
