import {CID} from "multiformats";
import {UnixFS} from "ipfs-unixfs";
import * as dagJSON from "multiformats/codecs/json";
import type {PBLink} from "@ipld/dag-pb";
import PeerId from "peer-id";
import type {Multiaddr} from "multiaddr";
import {allSelector, Node, parseContext, walkBlocks} from "./traversal";
import mime from "mime/lite";
import type {GraphSync} from "./graphsync";

const EXTENSION = "fil/data-transfer/1.1";

export function toPathComponents(path = ""): string[] {
  // split on / unless escaped with \
  return (path.trim().match(/([^\\^/]|\\\/)+/g) || []).filter(Boolean);
}

export function parsePath(path: string): {root: CID; segments: string[]} {
  const comps = toPathComponents(path);
  const root = CID.parse(comps[0]);
  return {
    segments: comps,
    root,
  };
}

export function getPeerID(addr: Multiaddr): PeerId {
  const addrStr = addr.toString();
  const parts = addrStr.split("/");
  const idx = parts.indexOf("p2p") + 1;
  if (idx === 0) {
    throw new Error("Multiaddr does not contain p2p peer ID");
  }
  return PeerId.createFromB58String(parts[idx]);
}

export async function* resolve(
  path: string,
  provider: Multiaddr,
  exchange: GraphSync
): AsyncIterable<any> {
  const {segments, root} = parsePath(path);
  let cid = root;
  let segs = segments.slice(1);
  const sel = allSelector;
  const pid = getPeerID(provider);
  exchange.network.peerStore.addressBook.add(pid, [provider]);
  const request = exchange.request(cid, sel);
  const id = Date.now();
  const voucher = {
    ID: id,
    PayloadCID: cid,
    Params: {
      Selector: sel,
      PieceCID: null,
      PricePerByte: new Uint8Array(),
      PaymentInterval: 1000,
      PaymentIntervalIncrease: 0,
      UnsealPrice: new Uint8Array(),
    },
  };
  request.open(pid, {
    [EXTENSION]: {
      IsRq: true,
      Request: {
        BCid: cid,
        Type: 0,
        Pull: true,
        Paus: false,
        Part: false,
        Stor: sel,
        Vouch: voucher,
        VTyp: "RetrievalDealProposal/1",
        XferID: id,
        RestartChannel: ["", "", 0],
      },
      Response: null,
    },
  });
  for await (const blk of walkBlocks(
    new Node(cid),
    parseContext().parseSelector(sel),
    request
  )) {
    // if not cbor or dagpb just return the bytes
    switch (blk.cid.code) {
      case 0x70:
      case 0x71:
        break;
      default:
        console.log("raw bytes");
        yield blk.bytes;
        continue;
    }
    try {
      const unixfs = UnixFS.unmarshal(blk.value.Data);
      if (unixfs.isDirectory()) {
        // if it's a directory and we have a segment to resolve, identify the link
        if (segs.length > 0) {
          for (const link of blk.value.Links) {
            if (link.Name === segs[0]) {
              cid = link.Hash;
              segs = segs.slice(1);
              console.log("found link in directory");
              continue;
            }
          }
          throw new Error("key not found: " + segs[0]);
        } else {
          // if the block is a directory and we have no key return the entries as JSON
          yield dagJSON.encode(
            blk.value.Links.map((l: PBLink) => ({
              name: l.Name,
              hash: l.Hash.toString(),
              size: l.Tsize,
            }))
          );
          break;
        }
      }
      if (unixfs.type === "file") {
        if (unixfs.data && unixfs.data.length) {
          console.log("unixfs file");
          yield unixfs.data;
        }
        continue;
      }
    } catch (e) {}
    // we're outside of unixfs territory
    // ignore
  }
  // tell the loader we're done receiving blocks for this traversal
  request.close();
}

type FetchInit = {
  headers: {[key: string]: string};
  provider: Multiaddr;
  exchange: GraphSync;
};

export async function fetch(url: string, init: FetchInit): Promise<Response> {
  const {headers, exchange, provider} = init;
  const content = resolve(url, provider, exchange);
  const iterator = content[Symbol.asyncIterator]();

  try {
    const parts = url.split(".");
    const extension = parts.length > 1 ? parts.pop() : undefined;
    const mt = extension ? mime.getType(extension) : undefined;
    if (mt) {
      headers["content-type"] = mt;
    }

    const {readable, writable} = new TransformStream();
    async function write() {
      const writer = writable.getWriter();
      try {
        let chunk = await iterator.next();

        while (chunk.value !== null && !chunk.done) {
          writer.write(chunk.value);
          chunk = await iterator.next();
        }
        writer.close();
      } catch (e) {
        console.log(e);
        writer.abort((e as Error).message);
      }
    }
    write();
    return new Response(readable, {
      status: 200,
      headers,
    });
  } catch (e) {
    return new Response((e as Error).message, {
      status: 500,
      headers,
    });
  }
}
