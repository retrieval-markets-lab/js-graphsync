import {
  GraphSyncRequest,
  GraphSyncMetadata,
  GraphSyncMessageRoot,
  ResponseStatusCode,
  GraphSyncBlock,
  GraphSyncLinkAction,
} from "./messages.js";
import * as dagCBOR from "@ipld/dag-cbor";
import type {CID} from "multiformats";
import varint from "varint";
import {
  Blockstore,
  walkBlocks,
  LinkSystem,
  unixfsReifier,
  BasicNode,
  parseContext,
} from "./traversal.js";

const MAX_SIZE = 256 * 1024;

function varintEncoder(buf: number[]): Uint8Array {
  let out = new Uint8Array(
    buf.reduce((acc, curr) => {
      return acc + varint.encodingLength(curr);
    }, 0)
  );
  let offset = 0;

  for (const num of buf) {
    out = varint.encode(num, out, offset);

    offset += varint.encodingLength(num);
  }

  return out;
}

function toPrefix(cid: CID): Uint8Array {
  const version = cid.version;
  const codec = cid.code;
  const multihash = cid.multihash.code;
  const digestLength = cid.multihash.digest.length;
  return varintEncoder([version, codec, multihash, digestLength]);
}

export async function* responseBuilder(
  req: GraphSyncRequest,
  store: Blockstore
): AsyncIterable<Uint8Array> {
  const ls = new LinkSystem(store, {unixfs: unixfsReifier});
  let blk: GraphSyncBlock[] = [];
  let meta: GraphSyncMetadata = [];
  let size = 0;
  for await (const block of walkBlocks(
    new BasicNode(req.root),
    parseContext().parseSelector(req.sel),
    ls
  )) {
    blk.push([toPrefix(block.cid), block.bytes]);
    meta.push([block.cid, GraphSyncLinkAction.Present]);
    size += block.bytes.length;
    if (size >= MAX_SIZE) {
      yield dagCBOR.encode<GraphSyncMessageRoot>({
        gs2: {
          rsp: [
            {
              reqid: req.id,
              stat: ResponseStatusCode.PartialResponse,
              meta,
            },
          ],
          blk,
        },
      });
      blk = [];
      meta = [];
      size = 0;
    }
  }
  yield dagCBOR.encode<GraphSyncMessageRoot>({
    gs2: {
      rsp: [
        {
          reqid: req.id,
          stat: ResponseStatusCode.RequestCompletedFull,
          meta,
        },
      ],
      blk,
    },
  });
}
