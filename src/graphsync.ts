import lp from "it-length-prefixed";
import type BufferList from "bl/BufferList";
import type {Network, ProtocolDialer} from "./network";
import type {HandlerProps} from "libp2p";
import type {CID, hasher} from "multiformats";
import type {Block} from "multiformats/block";
import type PeerId from "peer-id";
import {EventEmitter} from "events";
import {v4 as uuidv4, stringify as uuidStringify} from "uuid";
import {pipe} from "it-pipe";
import {AsyncLoader} from "./async-loader";
// @ts-ignore (no types)
import vd from "varint-decoder";
import {sha256} from "multiformats/hashes/sha2";
import drain from "it-drain";
import {
  PROTOCOL,
  GraphSyncBlock,
  decodeBlock,
  GraphSyncResponse,
  decodeMessage,
  newRequest,
} from "./messages";
import type {
  SelectorNode,
  Blockstore,
  KnownReifiers,
  NodeReifier,
} from "./traversal";
import {Node, walkBlocks, parseContext, unixfsReifier} from "./traversal";

export class GraphSync {
  started = false;
  network: Network;
  blocks: Blockstore;

  hashers: {[key: number]: hasher.MultihashHasher<any>} = {
    [sha256.code]: sha256,
  };

  requests: Map<string, Request> = new Map();

  constructor(net: Network, blocks: Blockstore) {
    this.network = net;
    this.blocks = blocks;
  }
  start() {
    if (!this.started) {
      this.network.handle(PROTOCOL, this._handler.bind(this));
      this.started = true;
    }
  }
  stop() {
    this.started = false;
    this.network.unhandle(PROTOCOL);
  }
  // creates a new request for the given link and selector
  request(link: CID, sel: SelectorNode): Request {
    const id = uuidv4();
    const request = new Request(id, link, sel, this.network, this.blocks);
    this.requests.set(id, request);
    return request;
  }
  _loadBlocksForRequests(gblocks: GraphSyncBlock[], reqids: string[]) {
    for (const block of gblocks) {
      decodeBlock(block, this.hashers)
        .then((blk) =>
          reqids.forEach((id) => {
            const req = this.requests.get(id);
            if (req) {
              req.loader.push(blk);
            }
          })
        )
        .catch((err) => {
          console.log(err);
        });
    }
  }
  _handleResponse(resp: GraphSyncResponse) {
    const req = this.requests.get(uuidStringify(resp.reqid));
    if (req) {
      req.incomingResponseHook(resp);
    }
  }
  async _handler(props: HandlerProps) {
    const source = props.stream.source as AsyncIterable<BufferList>;
    for await (const chunk of lp.decode()(source)) {
      const msg = decodeMessage(chunk.slice());
      if (msg.blk && msg.rsp) {
        this._loadBlocksForRequests(
          msg.blk,
          msg.rsp.map((resp) => uuidStringify(resp.reqid))
        );
      }
      if (msg.rsp) {
        msg.rsp.forEach((resp) => this._handleResponse(resp));
      }
    }
  }
}

export class Request extends EventEmitter {
  id: string;
  root: CID;
  selector: SelectorNode;
  dialer: ProtocolDialer;
  loader: AsyncLoader;

  reifiers: KnownReifiers = {
    unixfs: unixfsReifier,
  };

  constructor(
    id: string,
    root: CID,
    sel: SelectorNode,
    dialer: ProtocolDialer,
    blocks: Blockstore
  ) {
    super();

    this.id = id;
    this.dialer = dialer;
    this.root = root;
    this.selector = sel;
    this.loader = new AsyncLoader(blocks, this.incomingBlockHook.bind(this));
  }

  async open(peer: PeerId, extensions?: {[key: string]: any}) {
    const {stream} = await this.dialer.dialProtocol(peer, PROTOCOL);
    await pipe(
      [newRequest(this.id, this.root, this.selector, extensions)],
      stream
    );
  }

  async drain() {
    await drain(
      walkBlocks(
        new Node(this.root),
        parseContext().parseSelector(this.selector),
        this
      )
    );
  }

  reifier(name: string): NodeReifier {
    return this.reifiers[name];
  }

  // TODO
  close() {}

  load(link: CID): Promise<Block<any>> {
    return this.loader.load(link);
  }

  incomingBlockHook(block: Block<any>) {
    this.emit("incomingBlock", {link: block.cid, size: block.bytes.length});
  }

  incomingResponseHook(resp: GraphSyncResponse) {
    this.emit("incomingResponse", resp);
  }
}
