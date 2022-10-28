import type {IncomingStreamData} from "@libp2p/interface-registrar";
import type {Stream} from "@libp2p/interface-connection";
import type {PeerId} from "@libp2p/interface-peer-id";
import type {Multiaddr} from "@multiformats/multiaddr";
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
  handlers: {[key: string]: (props: IncomingStreamData) => void} = {};

  peerId: PeerId;
  connectionManager = new EventEmitter();
  peerStore = {
    addressBook: new MockAddressBook(),
  };

  sources: {[key: string]: AsyncIterable<BufferList>} = {};

  openStreams: Stream[] = [];

  constructor(peerId: PeerId) {
    this.peerId = peerId;
  }

  async handle(protocol: string, handler: (props: IncomingStreamData) => void) {
    this.handlers[protocol] = handler;
  }

  async unhandle(protocol: string | string[]) {
    const protos = Array.isArray(protocol) ? protocol : [protocol];
    protos.forEach((p) => {
      delete this.handlers[p];
    });
  }

  async dialProtocol(
    peer: PeerId | Multiaddr,
    protocols: string[] | string,
    options?: any
  ): Promise<Stream> {
    const id = "" + this.streamId++;
    const stream: Stream =
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
    return stream;
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
