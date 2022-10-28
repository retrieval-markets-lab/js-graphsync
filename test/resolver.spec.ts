import {expect} from "aegir/chai";
import {resolve, unixfsPathSelector} from "../src/resolver.js";
import {MemoryBlockstore} from "blockstore-core/memory";
import {MockLibp2p, concatChunkIterator} from "./mock-libp2p.js";
import {peerIdFromString} from "@libp2p/peer-id";
import {GraphSync} from "../src/graphsync.js";
import {importer} from "ipfs-unixfs-importer";

describe("resolver", () => {
  it("parse a unixfs path", () => {
    expect(() =>
      unixfsPathSelector(
        "bafyreiakhbtbs4tducqx5tcw36kdwodl6fdg43wnqaxmm64acckxhakeua/pictures/StefansCat.jpg"
      )
    ).to.not.throw();
  });

  it("resolves a unixfs directory from the store", async () => {
    const blocks = new MemoryBlockstore();

    const first = new Uint8Array(5 * 256);
    const second = new Uint8Array(3 * 256);

    // chunk and dagify it then get the root cid
    let cid;
    for await (const chunk of importer(
      [
        {path: "first", content: first},
        {path: "second", content: second},
      ],
      blocks,
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

    const libp2p = new MockLibp2p(
      peerIdFromString("12D3KooWSoLzampfxc4t3sy9z7yq1Cgzbi7zGXpV7nvt5hfeKUhR")
    );
    const exchange = new GraphSync(libp2p, blocks);

    if (!cid) {
      throw new Error("failed to import DAG");
    }
    const {root, selector} = unixfsPathSelector(cid.toString() + "/first");
    const request = exchange.request(root, selector);
    request.open(
      peerIdFromString("12D3KooWSWERLeRUwpGrigog1Aa3riz9zBSShBPqdMcqYsPs7Bfw")
    );
    const content = resolve(root, selector, request);
    const buf = await concatChunkIterator(content);
    expect(buf).to.deep.equal(first);
  });
});
