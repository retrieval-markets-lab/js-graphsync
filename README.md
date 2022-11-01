# GraphSync

![](https://img.shields.io/badge/made%20by-Myel-blue)
![](https://img.shields.io/github/license/myelnet/js-graphsync?color=green)

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

It is recommended to use with the [WebTransport](https://github.com/libp2p/js-libp2p-webtransport) transport for best performance.

```ts
import {createLibp2p} from "libp2p";
import {Noise} from "@chainsafe/libp2p-noise";
import {webTransport} from "@libp2p/webtransport";
import {MemoryBlockstore} from "blockstore-core/memory";
import {GraphSync, unixfsPathSelector, getPeer} from "@dcdn/graphsync";

const blocks = new MemoryBlockstore();

const libp2p = await createLibp2p({
  transports: [webTransport()],
  connectionEncryption: [() => new Noise()],
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
