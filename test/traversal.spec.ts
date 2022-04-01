import {expect} from "aegir/utils/chai.js";
import {encode} from "multiformats/block";
import * as dagCBOR from "@ipld/dag-cbor";
import {MemoryBlockstore} from "blockstore-core/memory";
import {sha256} from "multiformats/hashes/sha2";
import {
  Node,
  allSelector,
  parseContext,
  LinkSystem,
  walkBlocks,
  ExploreRecursive,
} from "../src/traversal";

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
      new Node(grandparent.cid),
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
});
