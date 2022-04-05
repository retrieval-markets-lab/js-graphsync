import {expect} from "aegir/utils/chai.js";
import {GraphSync} from "../src/graphsync";
import {PROTOCOL} from "../src/messages";
import {MockLibp2p, concatChunkIterator} from "./mock-libp2p";
import PeerId from "peer-id";
import {MemoryBlockstore} from "blockstore-core/memory";
import {importer} from "ipfs-unixfs-importer";
import {resolve, unixfsPathSelector} from "../src/resolver";

describe("graphsync", () => {
  it("e2e", async () => {
    const store1 = new MemoryBlockstore();
    const net1 = new MockLibp2p(
      PeerId.createFromB58String(
        "12D3KooWSoLzampfxc4t3sy9z7yq1Cgzbi7zGXpV7nvt5hfeKUhR"
      )
    );

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
    const net2 = new MockLibp2p(
      PeerId.createFromB58String(
        "12D3KooWHFrmLWTTDD4NodngtRMEVYgxrsDMp4F9iSwYntZ9WjHa"
      )
    );

    const provider = new GraphSync(net1, store1);
    provider.start();

    const {root, selector} = unixfsPathSelector(cid.toString() + "/second");
    const client = new GraphSync(net2, store2);
    client.start();

    const request = client.request(root, selector);
    const open = request.open(net1.peerId);

    const promise = concatChunkIterator(resolve(cid, selector, request));

    await open;

    const inbound = net2.openStreams.pop();
    if (!inbound) {
      throw new Error("could not create inbound stream");
    }
    await net1.handlers[PROTOCOL]({
      stream: inbound,
      // @ts-ignore
      connection: {remotePeer: net2.peerId},
    });

    const outbound = net1.openStreams.pop();
    if (!outbound) {
      throw new Error("could not create outbound stream");
    }

    await net2.handlers[PROTOCOL]({
      stream: outbound,
      // @ts-ignore
      connection: {remotePeer: net1.peerId},
    });

    const buf = await promise;
    expect(buf).to.deep.equal(second);
  });
});
