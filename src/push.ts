import type {GraphSync} from "./graphsync.js";
import {unixfsPathSelector, getPeerID} from "./resolver.js";
import type {Multiaddr} from "@multiformats/multiaddr";
import {pipe} from "it-pipe";
import * as dagCBOR from "@ipld/dag-cbor";
import type {TransferMessage, TransferResponse} from "./messages.js";
import {Uint8ArrayList} from "uint8arraylist";

const DT_PROTOCOL = "/fil/datatransfer/1.2.0";

type PushInit = {
  maddr: Multiaddr;
  exchange: GraphSync;
  voucher?: any;
  voucherType?: string;
};

/**
 * Convenience method for uploading content via the data-transfer protocol.
 * Simply pass a voucher and voucher type to authenticate the request.
 * Please note that this doesn't support voucher revalidation and more complex
 * stateful transfers.
 */
export async function push(path: string, init: PushInit): Promise<void> {
  const {exchange, maddr, voucher, voucherType} = init;
  const {root, selector} = unixfsPathSelector(path);
  const pid = getPeerID(maddr);
  exchange.network.peerStore.addressBook.add(pid, [maddr]);

  const id = Date.now();
  // data transfer will send a response with details if the request is accepted or refused.
  const resPromise = new Promise<TransferResponse>((resolve, reject) => {
    exchange.network.handle(DT_PROTOCOL, ({stream}) => {
      pipe(stream, async (source) => {
        const bl = new Uint8ArrayList();
        for await (const chunk of source) {
          bl.append(chunk);
        }
        const msg = dagCBOR.decode<TransferMessage>(bl.subarray());
        if (msg.Response && msg.Response.XferID === id) {
          resolve(msg.Response);
        }
      });
    });
  });

  const stream = await exchange.network.dialProtocol(pid, DT_PROTOCOL);
  await pipe(
    [
      dagCBOR.encode<TransferMessage>({
        IsRq: true,
        Request: {
          Type: 0,
          XferID: id,
          BCid: root,
          Paus: false,
          Part: false,
          Pull: false,
          Stor: selector,
          Vouch: voucher ?? null,
          VTyp: voucherType ?? "",
          RestartChannel: ["", "", 0],
        },
        Response: null,
      }),
    ],
    stream
  );
  await stream.close();
  const response = await resPromise;
  if (!response.Acpt) {
    throw new Error("request refused");
  }
}
