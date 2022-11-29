import type {Network, ProtocolDialer} from "./network.js";
import type {IncomingStreamData} from "@libp2p/interface-registrar";
import type {CID, hasher} from "multiformats";
import type {Block} from "multiformats/block";
import type {PeerId} from "@libp2p/interface-peer-id";
import {encode as lpEncode, decode as lpDecode} from "it-length-prefixed";
import {EventEmitter} from "events";
import {v4 as uuidv4, stringify as uuidStringify} from "uuid";
import {pipe} from "it-pipe";
import {AsyncLoader} from "./async-loader.js";
import {sha256} from "multiformats/hashes/sha2";
import drain from "it-drain";
import {
  PROTOCOL,
  GraphSyncBlock,
  decodeBlock,
  GraphSyncRequest,
  GraphSyncRequestType,
  GraphSyncResponse,
  decodeMessage,
  newRequest,
} from "./messages.js";
import {
  BasicNode,
  walkBlocks,
  parseContext,
  unixfsReifier,
} from "./traversal.js";
import type {
  NodeReifier,
  KnownReifiers,
  SelectorNode,
  Blockstore,
} from "./traversal.js";
import {responseBuilder} from "./response-builder.js";

export class GraphSync extends EventEmitter {
  started = false;
  network: Network;
  blocks: Blockstore;

  hashers: {[key: number]: hasher.MultihashHasher<any>} = {
    [sha256.code]: sha256,
  };

  requests: Map<string, Request> = new Map();

  constructor(net: Network, blocks: Blockstore) {
    super();
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
  async _handleRequest(peer: PeerId, req: GraphSyncRequest) {
    try {
      switch (req.type) {
        case GraphSyncRequestType.New:
          const stream = await this.network.dialProtocol(peer, PROTOCOL);
          await pipe(responseBuilder(req, this.blocks), lpEncode(), stream);
          await stream.close();
          this.emit("responseCompleted", {id: req.id, root: req.root, peer});
          break;
        case GraphSyncRequestType.Cancel:
          this.emit("requestCancelled", {id: req.id, root: req.root, peer});
          break;
        default:
          this.emit("networkErrorListener", {
            id: req.id,
            root: req.root,
            peer,
            error: new Error("unknown request type"),
          });
      }
    } catch (e) {
      this.emit("networkErrorListener", {
        id: req.id,
        root: req.root,
        peer,
        error: e,
      });
    }
  }
  async _handler({stream, connection}: IncomingStreamData) {
    for await (const chunk of lpDecode()(stream.source)) {
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
      if (msg.req) {
        msg.req.forEach((req) =>
          this._handleRequest(connection.remotePeer, req)
        );
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

  open(peer: PeerId, extensions?: {[key: string]: any}): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loader.setWaitNotify(async () => {
        this.loader.notifyWaiting = false;
        try {
          const stream = await this.dialer.dialProtocol(peer, PROTOCOL);
          await pipe(
            [newRequest(this.id, this.root, this.selector, extensions)],
            stream
          );
          await stream.close();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async drain() {
    await drain(
      walkBlocks(
        new BasicNode(this.root),
        parseContext().parseSelector(this.selector),
        this
      )
    );
  }

  reifier(name: string): NodeReifier {
    return this.reifiers[name];
  }

  addReifier(name: string, reifier: NodeReifier) {
    this.reifiers[name] = reifier;
  }

  // TODO
  close() {}

  load(link: CID): Promise<Block<any, any, any, any>> {
    return this.loader.load(link);
  }

  incomingBlockHook(block: Block<any, any, any, any>) {
    this.emit("incomingBlock", {link: block.cid, size: block.bytes.length});
  }

  incomingResponseHook(resp: GraphSyncResponse) {
    this.emit("incomingResponse", resp);
  }
}
