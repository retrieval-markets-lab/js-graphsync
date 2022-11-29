import {expect} from "aegir/chai";
import {encode} from "multiformats/block";
import * as dagCBOR from "@ipld/dag-cbor";
import {MemoryBlockstore} from "blockstore-core/memory";
import {sha256} from "multiformats/hashes/sha2";
import {importer} from "ipfs-unixfs-importer";
import {
  BasicNode,
  allSelector,
  parseContext,
  LinkSystem,
  walkBlocks,
  ExploreRecursive,
  unixfsReifier,
} from "../src/traversal.js";
import {unixfsPathSelector} from "../src/resolver.js";

describe("traversal", () => {
  it("walk blocks", async () => {
    const blocks = new MemoryBlockstore();
    const leaf1 = await encode({
      value: {
        name: "leaf1",
        size: 12,
      },
      hasher: sha256,
      codec: dagCBOR,
    });
    await blocks.put(leaf1.cid, leaf1.bytes);
    const leaf2 = await encode({
      value: {
        name: "leaf2",
        size: 12,
      },
      hasher: sha256,
      codec: dagCBOR,
    });
    await blocks.put(leaf2.cid, leaf2.bytes);
    const parent = await encode({
      value: {
        children: [leaf1.cid, leaf2.cid],
        favouriteChild: leaf2.cid,
        name: "parent",
      },
      hasher: sha256,
      codec: dagCBOR,
    });
    await blocks.put(parent.cid, parent.bytes);
    const lister = await encode({
      value: [parent.cid, leaf1.cid, leaf2.cid],
      hasher: sha256,
      codec: dagCBOR,
    });
    await blocks.put(lister.cid, lister.bytes);
    const grandparent = await encode({
      value: [
        {name: "parent", link: parent.cid},
        {name: "lister", link: lister.cid},
      ],
      hasher: sha256,
      codec: dagCBOR,
    });
    await blocks.put(grandparent.cid, grandparent.bytes);

    const source = new LinkSystem(blocks);

    const sel = parseContext().parseSelector(allSelector) as ExploreRecursive;
    expect(sel.limit.depth).to.equal(0);

    let i = 0;

    for await (const blk of walkBlocks(
      new BasicNode(grandparent.cid),
      sel,
      source
    )) {
      switch (i) {
        case 0:
          expect(blk.cid.toString()).to.equal(grandparent.cid.toString());
          break;
        case 1:
          expect(blk.cid.toString()).to.equal(parent.cid.toString());
          break;
        case 2:
          expect(blk.cid.toString()).to.equal(leaf1.cid.toString());
          break;
        case 3:
          expect(blk.cid.toString()).to.equal(leaf2.cid.toString());
          break;
        case 4:
          expect(blk.cid.toString()).to.equal(leaf2.cid.toString());
          break;
        case 5:
          expect(blk.cid.toString()).to.equal(lister.cid.toString());
          break;
        case 6:
          expect(blk.cid.toString()).to.equal(parent.cid.toString());
          break;
        case 7:
          expect(blk.cid.toString()).to.equal(leaf1.cid.toString());
          break;
        case 8:
          expect(blk.cid.toString()).to.equal(leaf2.cid.toString());
          break;
        case 9:
          expect(blk.cid.toString()).to.equal(leaf2.cid.toString());
          break;
        case 10:
          expect(blk.cid.toString()).to.equal(leaf1.cid.toString());
          break;
        case 11:
          expect(blk.cid.toString()).to.equal(leaf2.cid.toString());
          break;
      }
      i++;
    }
    expect(i).to.equal(12);
  });
  it("traverse unixfs path", async () => {
    const bs = new MemoryBlockstore();

    const first = new Uint8Array(5 * 256);
    const second = new Uint8Array(3 * 256);
    const third = new Uint8Array(2 * 256);
    const forth = new Uint8Array(4 * 256);

    // chunk and dagify it then get the root cid
    let cid;
    for await (const chunk of importer(
      [
        {path: "first", content: first},
        {path: "second", content: second},
        {path: "/children/third", content: third},
        {path: "/children/forth", content: forth},
      ],
      bs,
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

    const source = new LinkSystem(bs, {unixfs: unixfsReifier});

    const {root, selector} = unixfsPathSelector(cid?.toString() + "/second");

    let sel = parseContext().parseSelector(selector);

    let expected = [
      root.toString(),
      "bafybeihn4abm7nqsx3l3efwgdto6aqbbz3sduyiguhshypgzwp5i4hq2x4",
      "bafkreictihtlezdjpgtq4v3fgad2d4yqc2kcd3e33wpruvsi65nn4ac26e",
      "bafkreictihtlezdjpgtq4v3fgad2d4yqc2kcd3e33wpruvsi65nn4ac26e",
      "bafkreictihtlezdjpgtq4v3fgad2d4yqc2kcd3e33wpruvsi65nn4ac26e",
    ];

    let i = 0;

    for await (const blk of walkBlocks(new BasicNode(root), sel, source)) {
      expect(blk.cid.toString()).to.equal(expected[i]);
      i++;
    }
    expect(i).to.equal(expected.length);

    const {root: root2, selector: selector2} = unixfsPathSelector(
      cid?.toString() + "/children/third"
    );

    sel = parseContext().parseSelector(selector2);

    expected = [
      root2.toString(),
      "bafybeiepvdqmdakhtwotvykxujrmt5fcq4xca5jmoo6wzxhjk3q3pqe4te",
      "bafybeiadbpihdettqvip2z42x4hviblexbu3r364n6owtimuuzxwkmuyqy",
      "bafkreictihtlezdjpgtq4v3fgad2d4yqc2kcd3e33wpruvsi65nn4ac26e",
      "bafkreictihtlezdjpgtq4v3fgad2d4yqc2kcd3e33wpruvsi65nn4ac26e",
    ];

    i = 0;

    for await (const blk of walkBlocks(new BasicNode(root2), sel, source)) {
      expect(blk.cid.toString()).to.equal(expected[i]);
      i++;
    }
    expect(i).to.equal(expected.length);
  });
});
