import {CID} from "multiformats";
import {UnixFS} from "ipfs-unixfs";
import {peerIdFromString} from "@libp2p/peer-id";
import {multiaddr, Multiaddr} from "@multiformats/multiaddr";
import type {PeerId} from "@libp2p/interface-peer-id";
import {
  allSelector,
  Node,
  Kind,
  LinkLoader,
  parseContext,
  walkBlocks,
  SelectorNode,
} from "./traversal.js";
import mime from "mime/lite.js";
import type {GraphSync} from "./graphsync.js";

const EXTENSION = "fil/data-transfer/1.1";

export function toPathComponents(path = ""): string[] {
  // split on / unless escaped with \
  return (path.trim().match(/([^\\^/]|\\\/)+/g) || []).filter(Boolean);
}

export function parsePath(path: string): {root: CID; segments: string[]} {
  const comps = toPathComponents(path);
  const root = CID.parse(comps[0]);
  return {
    segments: comps.slice(1),
    root,
  };
}

export function unixfsPathSelector(path: string): {
  root: CID;
  selector: SelectorNode;
} {
  const {root, segments} = parsePath(path);
  let selector = allSelector;
  if (segments.length === 0) {
    return {root, selector};
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    selector = {
      "~": {
        as: "unixfs",
        ">": {
          f: {
            "f>": {
              [segments[i]]: selector,
            },
          },
        },
      },
    };
  }
  return {root, selector};
}

export function getPeerID(addr: Multiaddr): PeerId {
  const addrStr = addr.toString();
  const parts = addrStr.split("/");
  const idx = parts.indexOf("p2p") + 1;
  if (idx === 0) {
    throw new Error("Multiaddr does not contain p2p peer ID");
  }
  return peerIdFromString(parts[idx]);
}

export function getPeer(addr: string): {id: PeerId; multiaddrs: Multiaddr[]} {
  const ma = multiaddr(addr);
  return {
    id: getPeerID(ma),
    multiaddrs: [ma],
  };
}

// Iterate an IPLD traversal and resolve UnixFS blocks
export async function* resolve(
  root: CID,
  selector: SelectorNode,
  loader: LinkLoader
): AsyncIterable<Uint8Array> {
  for await (const blk of walkBlocks(
    new Node(root),
    parseContext().parseSelector(selector),
    loader
  )) {
    // if not cbor or dagpb just return the bytes
    switch (blk.cid.code) {
      case 0x70:
      case 0x71:
        break;
      default:
        yield blk.bytes;
        continue;
    }
    if (blk.value.kind === Kind.Map && blk.value.Data) {
      try {
        const unixfs = UnixFS.unmarshal(blk.value.Data);
        if (unixfs.type === "file") {
          if (unixfs.data && unixfs.data.length) {
            yield unixfs.data;
          }
          continue;
        }
      } catch (e) {}
      // we're outside of unixfs territory
      // ignore
    }
  }
}

type FetchInit = {
  headers: {[key: string]: string};
  provider: Multiaddr;
  exchange: GraphSync;
  voucher?: any;
  voucherType?: string;
};

/**
 * Convenience method for consuming graphsync content as an HTTP Response object.
 * fecth also supports authenticating requests via the data-transfer protocol used by Filecoin.
 * Please note that it doesn't support revalidation.
 */
export async function fetch(url: string, init: FetchInit): Promise<Response> {
  const {headers, exchange, provider, voucher, voucherType} = init;

  const {root, selector: sel} = unixfsPathSelector(url);
  const pid = getPeerID(provider);
  exchange.network.peerStore.addressBook.add(pid, [provider]);
  const request = exchange.request(root, sel);
  const extensions: {[key: string]: any} = {};
  if (voucher && voucherType) {
    const id = Date.now();
    extensions[EXTENSION] = {
      IsRq: true,
      Request: {
        BCid: root,
        Type: 0,
        Pull: true,
        Paus: false,
        Part: false,
        Stor: sel,
        Vouch: voucher,
        VTyp: voucherType,
        XferID: id,
        RestartChannel: ["", "", 0],
      },
      Response: null,
    };
  }
  request.open(pid, extensions);

  const content = resolve(root, sel, request);
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
      request.close();
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
