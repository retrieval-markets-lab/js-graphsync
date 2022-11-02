import type {Network} from "./network.js";
import type {CID, hasher} from "multiformats";
import type {PeerId} from "@libp2p/interface-peer-id";
import {encode as lpEncode, decode as lpDecode} from "it-length-prefixed";
import {v4 as uuidv4, stringify as uuidStringify} from "uuid";
import {pipe} from "it-pipe";
import {AsyncLoader} from "./async-loader.js";
import {sha256} from "multiformats/hashes/sha2";
import {
  PROTOCOL,
  decodeBlock,
  GraphSyncRequestType,
  decodeMessage,
  newRequest,
} from "./messages.js";
import type {SelectorNode, Blockstore} from "./traversal.js";
import {unixfsReifier} from "./traversal.js";
import {responseBuilder} from "./response-builder.js";

export type Request = {
  loader: AsyncLoader;
  close: () => void;
};

export type GraphSync = {
  request: (
    root: CID,
    selector: SelectorNode,
    peer: PeerId,
    extensions?: {[key: string]: any}
  ) => Promise<Request>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  network: Network;
  isStarted: () => boolean;
};

export function graphsync(
  blocks: Blockstore,
  libp2p: Network,
  hashers: {[key: number]: hasher.MultihashHasher<any>} = {
    [sha256.code]: sha256,
  }
): GraphSync {
  const requests: Map<string, Request> = new Map();
  let started = false;

  return {
    request: async function (
      root: CID,
      selector: SelectorNode,
      peer: PeerId,
      extensions?: {[key: string]: any}
    ): Promise<Request> {
      const loader = new AsyncLoader(blocks);
      loader.reifiers = {
        unixfs: unixfsReifier,
      };

      const stream = await libp2p.dialProtocol(peer, PROTOCOL);
      const id = uuidv4();
      const req = {
        loader,
        close: () => {
          requests.delete(id);
        },
      };
      requests.set(id, req);

      await pipe([newRequest(id, root, selector, extensions)], stream);
      stream.close();

      return req;
    },
    start: async function () {
      if (started) {
        return;
      }
      await libp2p.handle(PROTOCOL, async ({stream, connection}) => {
        for await (const chunk of lpDecode()(stream.source)) {
          const msg = decodeMessage(chunk.slice());
          if (msg.blk && msg.rsp) {
            for (const block of msg.blk) {
              decodeBlock(block, hashers)
                .then((blk) => {
                  msg.rsp!.forEach((rsp) => {
                    const req = requests.get(uuidStringify(rsp.reqid));
                    if (req) {
                      req.loader.push(blk);
                    }
                  });
                })
                .catch((err) => {
                  console.log(err);
                });
            }
          }
          if (msg.req) {
            msg.req.forEach(async (req) => {
              switch (req.type) {
                case GraphSyncRequestType.New:
                  const stream = await libp2p.dialProtocol(
                    connection.remotePeer,
                    PROTOCOL
                  );
                  await pipe(responseBuilder(req, blocks), lpEncode(), stream);
                  await stream.close();
                  break;
                default:
              }
            });
          }
        }
      });
      started = true;
    },
    stop: async function () {
      if (!started) {
        return;
      }
      await libp2p.unhandle(PROTOCOL);
      started = false;
    },
    network: libp2p,
    isStarted: function () {
      return started;
    },
  };
}
