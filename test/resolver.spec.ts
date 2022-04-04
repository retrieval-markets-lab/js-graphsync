import {expect} from "aegir/utils/chai.js";
import {resolve, unixfsPathSelector} from "../src/resolver";
import {MemoryBlockstore} from "blockstore-core/memory";
import {MockLibp2p} from "./mock-libp2p";
import PeerId from "peer-id";
import {multiaddr} from "multiaddr";
import {GraphSync} from "../src/graphsync";
import {importer} from "ipfs-unixfs-importer";
import {concat as concatUint8Arrays} from "uint8arrays/concat";

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
      PeerId.createFromB58String(
        "12D3KooWSoLzampfxc4t3sy9z7yq1Cgzbi7zGXpV7nvt5hfeKUhR"
      )
    );
    const exchange = new GraphSync(libp2p, blocks);

    if (!cid) {
      throw new Error("failed to import DAG");
    }
    const content = resolve(
      cid.toString() + "/first",
      multiaddr(
        "/ip4/127.0.0.1/tcp/41505/ws/p2p/12D3KooWSWERLeRUwpGrigog1Aa3riz9zBSShBPqdMcqYsPs7Bfw"
      ),
      exchange
    );
    const iterator = content[Symbol.asyncIterator]();
    let {value, done} = await iterator.next();
    let buf = value;
    while (!done) {
      ({value, done} = await iterator.next());
      if (value) {
        buf = concatUint8Arrays([buf, value], buf.length + value.length);
      }
    }
    expect(buf).to.deep.equal(first);
  });
});
