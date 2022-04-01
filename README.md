# GraphSync

> JS implementation of the GraphSync v2 wire protocol.

## Background

GraphSync is an IPFS data transfer protocol used across the IPFS and Web3 ecosystem for exchanging
IPLD data. It is used by Filecoin for syncing the blockchain and transfering DAGified content
in a trustless fashion.

## Install

```
npm install @dcdn/graphsync
```

## Usage

```ts
import {create, getPeer} from "libp2p";
import {Noise} from "@chainsafe/libp2p-noise";
import WebSockets from "libp2p-websockets";
import Mplex from "libp2p-mplex";
import {MemoryBlockstore} from "blockstore-core/memory";
import {GraphSync, unixfsPathSelector} from "@dcdn/graphsync";

const blocks = new MemoryBlockstore();

const libp2p = await createLibp2p({
  modules: {
    transport: [WebSockets],
    connEncryption: [new Noise()],
    streamMuxer: [Mplex],
  },
  config: {
    peerDiscovery: {
      autoDial: false,
    },
  },
});
await libp2p.start();
    
const exchange = new GraphSync(libp2p, blocks);

const provider = getPeer("/ip4/127.0.0.1/tcp/41505/ws/p2p/12D3KooWCYiNWNDoprcW74NVCEKaMhSbrfMvY4JEMfWrV1JamSsA");
libp2p.peerStore.addressBook.add(provider.id, provider.multiaddrs);
const [cid, selector] = unixfsPathSelector("bafyreiakhbtbs4tducqx5tcw36kdwodl6fdg43wnqaxmm64acckxhakeua/Cat.jpg");

const request = exchange.request(cid, selector);
request.open(provider.id);
// Save the blocks into the store;
await request.drain();

```
