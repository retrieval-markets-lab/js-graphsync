import {expect} from "aegir/chai";
import {graphsync} from "../src/graphsync.js";
import {PROTOCOL} from "../src/messages.js";
import {MockLibp2p, concatChunkIterator} from "./mock-libp2p.js";
import {peerIdFromString} from "@libp2p/peer-id";
import {MemoryBlockstore} from "blockstore-core/memory";
import {importer} from "ipfs-unixfs-importer";
import {resolve, unixfsPathSelector} from "../src/resolver.js";

describe("graphsync", () => {
  // this test mocks libp2p so it can run in the browser.
  it("e2e", async () => {
    const store1 = new MemoryBlockstore();
    const net1 = new MockLibp2p(
      peerIdFromString("12D3KooWSoLzampfxc4t3sy9z7yq1Cgzbi7zGXpV7nvt5hfeKUhR")
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
      peerIdFromString("12D3KooWHFrmLWTTDD4NodngtRMEVYgxrsDMp4F9iSwYntZ9WjHa")
    );

    const provider = graphsync(store1, net1);
    await provider.start();

    const {root, selector} = unixfsPathSelector(cid.toString() + "/second");
    const client = graphsync(store2, net2);
    client.start();

    const request = await client.request(root, selector, net1.peerId);

    const promise = concatChunkIterator(resolve(cid, selector, request.loader));

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
