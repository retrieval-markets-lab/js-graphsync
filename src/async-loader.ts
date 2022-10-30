import {
  LinkLoader,
  Blockstore,
  blockFromStore,
  KnownReifiers,
  NodeReifier,
} from "./traversal.js";
import type {Block} from "multiformats/block";
import type {CID} from "multiformats";

interface Resolvable {
  resolve: (res: Block<any, any, any, any>) => void;
  reject: (res: Error) => void;
}

export type BlockNotifyFn = (block: Block<any, any, any, any>) => void;

export type WaitNotifyFn = (cid: CID) => void;

// AsyncLoader waits for a block to be anounced if it is not available in the blockstore
export class AsyncLoader implements LinkLoader {
  store: Blockstore;
  // notify callback everytime a new block is loaded
  tracker?: BlockNotifyFn;
  // notify callback when the loader is waiting for a bock
  waitNotify?: WaitNotifyFn;
  // pending are block that have been pushed but not yet loaded
  pending: Map<string, Block<any, any, any, any>> = new Map();
  // loaded is a set of string CIDs for content that was loaded.
  // content included in the set will be flushed to the blockstore.
  loaded: Set<string> = new Set();

  pullQueue: Map<string, Resolvable[]> = new Map();

  reifiers: KnownReifiers = {};

  notifyWaiting = false;

  constructor(
    store: Blockstore,
    tracker?: BlockNotifyFn,
    waitNotify?: WaitNotifyFn
  ) {
    this.store = store;
    this.tracker = tracker;
    if (waitNotify) {
      this.setWaitNotify(waitNotify);
    }
  }
  async load(cid: CID): Promise<Block<any, any, any, any>> {
    const k = cid.toString();
    try {
      let blk = this.pending.get(k);
      if (blk) {
        this.flush(blk);
        return blk;
      }
      blk = await blockFromStore(cid, this.store);
      return blk;
    } catch (e) {
      const blk = await this.waitForBlock(cid);
      this.flush(blk);
      return blk;
    } finally {
      this.loaded.add(k);
    }
  }
  // waitForBlock will queue up a promise that will get resolved once a block
  // is pushed to the loader.
  async waitForBlock(cid: CID): Promise<Block<any, any, any, any>> {
    const block = this.pending.get(cid.toString());
    if (block) {
      return block;
    }
    if (this.loaded.has(cid.toString())) {
      return blockFromStore(cid, this.store);
    }

    if (this.waitNotify && this.notifyWaiting) {
      this.waitNotify(cid);
    }

    return new Promise((resolve, reject) => {
      this.pullQueue.set(
        cid.toString(),
        (this.pullQueue.get(cid.toString()) ?? []).concat({resolve, reject})
      );
    });
  }

  // these are trusted blocks and don't need to be verified
  push(block: Block<any, any, any, any>) {
    const k = block.cid.toString();
    const pending = this.pullQueue.get(k);
    if (pending) {
      pending.forEach((p) => p.resolve(block));
    } else {
      this.pending.set(k, block);
    }
  }
  // move a pending block to the blockstore.
  flush(blk: Block<any, any, any, any>) {
    if (!this.loaded.has(blk.cid.toString())) {
      this.tracker?.(blk);
      this.store
        .put(blk.cid, new Uint8Array(blk.bytes))
        .then(() => this.pending.delete(blk.cid.toString()));
    }
  }
  reifier(name: string): NodeReifier {
    return this.reifiers[name];
  }
  // cleanup any block in memory
  close() {
    this.pending = new Map();
  }

  setWaitNotify(cb: WaitNotifyFn) {
    this.waitNotify = cb;
    this.notifyWaiting = true;
  }
}
