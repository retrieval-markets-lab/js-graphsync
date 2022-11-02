import fs from "fs";
import resolve from "aegir/resolve";
import {benchmarkPromise, report} from "@stablelib/benchmark";
import {CarBlockIterator} from "@ipld/car";
import {CarIndexedReader} from "@ipld/car/indexed-reader";
import type {CID} from "multiformats";
import {sha256} from "multiformats/hashes/sha2";
import {equals} from "multiformats/hashes/digest";
import * as raw from "multiformats/codecs/raw";
import * as dagCbor from "@ipld/dag-cbor";
import * as dagPb from "@ipld/dag-pb";
import {
  LinkLoader,
  walkBlocks,
  decoderFor,
  Node,
  allSelector,
  parseContext,
} from "../src/traversal.js";
import {responseBuilder} from "../src/response-builder.js";
import {
  GraphSyncRequestType,
  decodeMessage,
  decodeBlock,
} from "../src/messages.js";
import {AsyncLoader} from "../src/async-loader.js";
import {Block} from "multiformats/block";
import {BaseBlockstore} from "blockstore-core/base";
import {MemoryBlockstore} from "blockstore-core/memory";
import type {Options} from "interface-store";
import {createLibp2p, Libp2p} from "libp2p";
import {tcp} from "@libp2p/tcp";
import {Noise} from "@chainsafe/libp2p-noise";
// import {plaintext} from "libp2p/insecure";
import {graphsync} from "../src/graphsync.js";
import {unixfsPathSelector, resolve as resolveIpld} from "../src/resolver.js";
import {mplex} from "@libp2p/mplex";
import {pipe} from "it-pipe";

const car_file = resolve("test/fixtures/blackhole.car");

const codecs: {[key: number]: any} = {
  [dagCbor.code]: dagCbor,
  [dagPb.code]: dagPb,
  [raw.code]: raw,
};

const hashes: {[key: number]: any} = {
  [sha256.code]: sha256,
};

async function validateCarBlock(cid: CID, bytes: Uint8Array) {
  if (!codecs[cid.code]) {
    return false;
  }
  if (!hashes[cid.multihash.code]) {
    return false;
  }

  const hash = await hashes[cid.multihash.code].digest(bytes);
  if (!equals(hash.digest, cid.multihash.digest)) {
    return false;
  }

  return true;
}

function loaderFromCar(index: CarIndexedReader): LinkLoader {
  return {
    async load(cid: CID): Promise<Block<any, any, any, any>> {
      const blk = await index.get(cid);
      if (!blk) {
        throw new Error("not found");
      }
      const decode = decoderFor(blk.cid);
      return new Block({
        cid,
        bytes: blk.bytes,
        value: decode ? decode(blk.bytes) : blk.bytes,
      });
    },
    reifier(name: string) {
      return undefined;
    },
    close() {
      index.close();
    },
  };
}

class CarBlockstore extends BaseBlockstore {
  index: CarIndexedReader;
  constructor(index: CarIndexedReader) {
    super();
    this.index = index;
  }
  close() {
    return this.index.close();
  }
  async get(key: CID, options?: Options) {
    const blk = await this.index.get(key);
    if (!blk) {
      throw new Error("not found");
    }
    return blk.bytes;
  }
}

async function createNode(): Promise<Libp2p> {
  const node = await createLibp2p({
    addresses: {
      listen: ["/ip4/0.0.0.0/tcp/0"],
    },
    streamMuxers: [mplex()],
    transports: [tcp()],
    // connectionEncryption: [plaintext()],
    connectionEncryption: [() => new Noise()],
  });
  await node.start();
  return node;
}

describe.skip("benchmarks", () => {
  const size = fs.statSync(car_file).size;

  it.skip("verify car file", async () => {
    report(
      "car stream",
      await benchmarkPromise(async () => {
        const stream = fs.createReadStream(car_file);
        const carBlockIterator = await CarBlockIterator.fromIterable(stream);

        for await (const {cid, bytes} of carBlockIterator) {
          if (!validateCarBlock(cid, bytes)) {
            throw new Error("CAR file invalid");
          }
        }
      }, size)
    );
  });

  it.skip("traverses a car file", async () => {
    const reader = await CarIndexedReader.fromFile(car_file);
    const loader = loaderFromCar(reader);

    const root = (await reader.getRoots())[0];

    const sel = parseContext().parseSelector(allSelector);

    report(
      "dag traversal",
      await benchmarkPromise(async () => {
        for await (const _ of walkBlocks(new Node(root), sel, loader)) {
        }
      }, size)
    );
  });

  it.skip("streams from graphsync messages", async () => {
    const reader = await CarIndexedReader.fromFile(car_file);
    const store = new CarBlockstore(reader);
    const root = (await reader.getRoots())[0];

    const sel = parseContext().parseSelector(allSelector);

    const req = {
      id: new Uint8Array(0),
      type: GraphSyncRequestType.New,
      pri: 0,
      root,
      sel: allSelector,
    };

    const msgs: Uint8Array[] = [];
    for await (const buf of responseBuilder(req, store)) {
      msgs.push(buf);
    }

    report(
      "graphsync stream",
      await benchmarkPromise(async () => {
        const blocks = new MemoryBlockstore();
        const aloader = new AsyncLoader(blocks, () => {});

        await Promise.all([
          (async () => {
            for (let i = 0; i < msgs.length; i++) {
              const msg = decodeMessage(msgs[i]);
              for (const block of msg.blk!) {
                aloader.push(await decodeBlock(block, hashes));
              }
            }
          })(),
          (async () => {
            for await (const _ of walkBlocks(new Node(root), sel, aloader)) {
            }
          })(),
        ]);
      }, size)
    );
  });

  it("streams a whole file", async () => {
    const PROTO = "/file";

    const options = () => ({
      addresses: {
        listen: ["/ip4/0.0.0.0/tcp/0"],
      },
      streamMuxers: [mplex()],
      transports: [tcp()],
      // connectionEncryption: [plaintext()],
      connectionEncryption: [() => new Noise()],
    });

    const node1 = await createLibp2p(options());
    await node1.start();

    const node2 = await createLibp2p(options());
    await node2.start();

    node2.peerStore.addressBook.add(node1.peerId, node1.getMultiaddrs());

    // iterate as many times as needed then report the result
    report(
      "stream file",
      await benchmarkPromise(async () => {
        const file = fs.createReadStream(car_file);

        const receive = new Promise((resolve) => {
          node1.handle(PROTO, async ({stream}) => {
            for await (const _ of stream.source);
            resolve(null);
          });
        });

        await Promise.all([
          receive,
          (async () => {
            const stream = await node2.dialProtocol(node1.peerId, PROTO);
            await pipe(file, stream);
            await stream.close();
          })(),
        ]);

        await node1.unhandle(PROTO);
      }, size)
    );

    await node1.stop();
    await node2.stop();
  });

  it.skip("transfers e2e", async () => {
    const reader = await CarIndexedReader.fromFile(car_file);
    const store1 = new CarBlockstore(reader);
    const cid = (await reader.getRoots())[0];

    const net1 = await createNode();
    const net2 = await createNode();
    net2.peerStore.addressBook.add(net1.peerId, net1.getMultiaddrs());

    const provider = graphsync(store1, net1);
    await provider.start();

    report(
      "graphsync e2e",
      await benchmarkPromise(async () => {
        const store2 = new MemoryBlockstore();
        const client = graphsync(store2, net2, hashes);
        await client.start();

        const {root, selector} = unixfsPathSelector(
          cid.toString() + "/blackhole.gif"
        );

        const {loader} = await client.request(root, selector, net1.peerId);

        for await (const _ of resolveIpld(cid, selector, loader)) {
        }
        await client.stop();
      }, size)
    );

    await net1.stop();
    await net2.stop();
    await reader.close();
  });
});
