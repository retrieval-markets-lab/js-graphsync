import {expect} from "aegir/utils/chai.js";
import {create as createLibp2p, Libp2p} from "libp2p";
import PeerId from "peer-id";
import Mplex from "libp2p-mplex";
import TCP from "libp2p-tcp";
import {NOISE} from "@chainsafe/libp2p-noise";
import {MemoryBlockstore} from "blockstore-core/memory";
import {importer} from "ipfs-unixfs-importer";
import {GraphSync} from "../src/graphsync";
import {unixfsPathSelector, resolve} from "../src/resolver";
import {concatChunkIterator} from "./mock-libp2p";

async function createNode(): Promise<Libp2p> {
  const node = await createLibp2p({
    addresses: {
      listen: ["/ip4/0.0.0.0/tcp/0"],
    },
    modules: {
      transport: [TCP],
      connEncryption: [NOISE],
      streamMuxer: [Mplex],
    },
  });
  await node.start();
  return node;
}

describe("listening", () => {
  it("reified transfer", async () => {
    const store1 = new MemoryBlockstore();
    const net1 = await createNode();

    const first = new Uint8Array(5 * 256);
    const second = new Uint8Array(3 * 256);

    // chunk and dagify it then get the root cid
    let cid;
    for await (const chunk of importer(
      [
        {path: "first", content: first},
        {path: "second", content: second},
      ],
      store1,
      {
        cidVersion: 1,
        maxChunkSize: 256,
        rawLeaves: true,
        wrapWithDirectory: true,
      }
    )) {
      if (chunk.path === "") {
        cid = chunk.cid;
      }
    }

    if (!cid) {
      throw new Error("failed to add DAG");
    }

    const store2 = new MemoryBlockstore();
    const net2 = await createNode();

    net2.peerStore.addressBook.add(net1.peerId, net1.multiaddrs);

    const provider = new GraphSync(net1, store1);
    provider.start();

    const client = new GraphSync(net2, store2);
    client.start();
    const {root, selector} = unixfsPathSelector(cid.toString() + "/first");

    const request = client.request(root, selector);
    request.open(net1.peerId);

    const buf = await concatChunkIterator(resolve(cid, selector, request));
    expect(buf).to.deep.equal(first);
  });
});
