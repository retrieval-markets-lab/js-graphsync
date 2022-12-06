import {expect} from "aegir/chai";
import {
  resolve,
  unixfsPathSelector,
  getPeer,
  resolveQuery,
} from "../src/resolver.js";
import {
  selectorBuilder as sb,
  BasicNode,
  parseContext,
  LinkSystem,
} from "../src/traversal.js";
import {MemoryBlockstore} from "blockstore-core/memory";
import {MockLibp2p, concatChunkIterator} from "./mock-libp2p.js";
import {peerIdFromString} from "@libp2p/peer-id";
import {GraphSync} from "../src/graphsync.js";
import {importer} from "ipfs-unixfs-importer";
import {encode} from "multiformats/block";
import * as codec from "@ipld/dag-cbor";
import {sha256 as hasher} from "multiformats/hashes/sha2";

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

  it("can parse a peer info", () => {
    const {id, multiaddrs} = getPeer(
      "/ip4/127.0.0.1/tcp/41505/ws/p2p/12D3KooWCYiNWNDoprcW74NVCEKaMhSbrfMvY4JEMfWrV1JamSsA"
    );
    expect(id.toString()).to.equal(
      "12D3KooWCYiNWNDoprcW74NVCEKaMhSbrfMvY4JEMfWrV1JamSsA"
    );
    expect(multiaddrs[0].protos()[0].name).to.equal("ip4");
  });

  it("resolves a query", async () => {
    const blocks = new MemoryBlockstore();

    const account1 = {
      balance: 300,
      lastUpdated: "yesterday",
    };
    const account1Block = await encode({value: account1, codec, hasher});
    await blocks.put(account1Block.cid, account1Block.bytes);

    const account2 = {
      balance: 100,
      lastUpdated: "now",
    };
    const account2Block = await encode({value: account2, codec, hasher});
    await blocks.put(account2Block.cid, account2Block.bytes);

    const state = {
      "0x01": account1Block.cid,
      "0x02": account2Block.cid,
    };
    const stateBlock = await encode({value: state, codec, hasher});
    await blocks.put(stateBlock.cid, stateBlock.bytes);

    const msg = {
      from: "0x01",
      to: "0x02",
      amount: 100,
    };
    const msgBlock = await encode({value: msg, codec, hasher});
    await blocks.put(msgBlock.cid, msgBlock.bytes);

    const root = {
      state: stateBlock.cid,
      epoch: Date.now(),
      messages: [msgBlock.cid],
    };
    const rootBlock = await encode({value: root, codec, hasher});
    await blocks.put(rootBlock.cid, rootBlock.bytes);

    const selector = sb.exploreFields({
      state: sb.exploreFields({
        "0x02": sb.exploreFields({
          balance: sb.match(),
          lastUpdated: sb.match(),
        }),
      }),
      messages: sb.exploreIndex(
        0,
        sb.exploreFields({
          amount: sb.match(),
        })
      ),
    });
    const sel = parseContext().parseSelector(selector);
    const ls = new LinkSystem(blocks);

    const result = await resolveQuery(new BasicNode(root), sel, ls);

    expect(result).to.deep.equal({
      state: {
        "0x02": {
          balance: 100,
          lastUpdated: "now",
        },
      },
      messages: [{amount: 100}],
    });
  });
});
