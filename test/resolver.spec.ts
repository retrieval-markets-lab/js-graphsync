import {expect} from "aegir/chai";
import {resolve, unixfsPathSelector, getPeer} from "../src/resolver.js";
import {MemoryBlockstore} from "blockstore-core/memory";
import {MockLibp2p, concatChunkIterator} from "./mock-libp2p.js";
import {peerIdFromString} from "@libp2p/peer-id";
import {graphsync} from "../src/graphsync.js";
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
    const exchange = graphsync(blocks, libp2p);

    if (!cid) {
      throw new Error("failed to import DAG");
    }
    const {root, selector} = unixfsPathSelector(cid.toString() + "/first");
    const request = await exchange.request(
      root,
      selector,
      peerIdFromString("12D3KooWSWERLeRUwpGrigog1Aa3riz9zBSShBPqdMcqYsPs7Bfw")
    );
    const content = resolve(root, selector, request.loader);
    const buf = await concatChunkIterator(content);
    expect(buf).to.deep.equal(first);
  });

  it("can parse a peer info", () => {
    const {id, multiaddrs} = getPeer(
      "/ip4/127.0.0.1/tcp/41505/ws/p2p/12D3KooWCYiNWNDoprcW74NVCEKaMhSbrfMvY4JEMfWrV1JamSsA"
    );
    expect(id.toString()).to.equal(
      "12D3KooWCYiNWNDoprcW74NVCEKaMhSbrfMvY4JEMfWrV1JamSsA"
    );
    expect(multiaddrs[0].protos()[0].name).to.equal("ip4");
  });
});
