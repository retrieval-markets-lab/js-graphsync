import {CID, hasher} from "multiformats";
import {Block} from "multiformats/block";
import {Buffer} from "buffer";
import {parse as uuidParse} from "uuid";
import * as dagCBOR from "@ipld/dag-cbor";
import type {Uint8ArrayList} from "uint8arraylist";
import varint from "varint";
import {encode} from "it-length-prefixed";
import {SelectorNode, decoderFor} from "./traversal.js";

export const PROTOCOL = "/ipfs/graphsync/2.0.0";

export const DT_PROTOCOL = "/fil/datatransfer/1.1.0";

export type ChannelID = [string, string, number];

export type TransferMessage = {
  IsRq: boolean;
  Request: TransferRequest | null;
  Response: TransferResponse | null;
};

export type TransferRequest = {
  Type: number;
  XferID: number;
  BCid: CID | null;
  Paus: boolean;
  Part: boolean;
  Pull: boolean;
  Stor: SelectorNode | null;
  Vouch: any | null;
  VTyp: string;
  RestartChannel: ChannelID;
};

export type TransferResponse = {
  Type: number;
  Acpt: boolean;
  Paus: boolean;
  XferID: number;
  VRes: any | null;
  VTyp: string;
};

export enum ResponseStatusCode {
  RequestAcknowledged = 10,
  PartialResponse = 14,
  RequestPaused = 15,
  RequestCompletedFull = 20,
  RequestCompletedPartial = 21,
  RequestRejected = 30,
  RequestFailedBusy = 31,
  RequestFailedUnknown = 32,
  RequestFailedLegal = 33,
  RequestFailedContentNotFound = 34,
  RequestCancelled = 35,
}

export const statuses = {
  [ResponseStatusCode.RequestAcknowledged]: "RequestAcknowledged",
  [ResponseStatusCode.PartialResponse]: "PartialResponse",
  [ResponseStatusCode.RequestPaused]: "RequestPaused",
  [ResponseStatusCode.RequestCompletedFull]: "RequestCompletedFull",
  [ResponseStatusCode.RequestCompletedPartial]: "RequestCompletedPartial",
  [ResponseStatusCode.RequestRejected]: "RequestRejected",
  [ResponseStatusCode.RequestFailedBusy]: "RequestFailedBusy",
  [ResponseStatusCode.RequestFailedUnknown]: "RequestFailedUnknown",
  [ResponseStatusCode.RequestFailedLegal]: "RequestFailedLegal",
  [ResponseStatusCode.RequestFailedContentNotFound]:
    "RequestFailedContentNotFound",
  [ResponseStatusCode.RequestCancelled]: "RequestCancelled",
};

export enum GraphSyncLinkAction {
  Present = "p",
  DuplicateNotSent = "d",
  Missing = "m",
  DuplicateDAGSkipped = "s",
}

// prefix, data
export type GraphSyncBlock = [Uint8Array, Uint8Array];

type GraphSyncPriority = number;

type GraphSyncMetadatum = [CID, GraphSyncLinkAction];

export type GraphSyncMetadata = GraphSyncMetadatum[];

export enum GraphSyncRequestType {
  New = "n",
  Cancel = "c",
  Update = "u",
}

export type GraphSyncExtensions = {
  [key: string]: any;
};

export type GraphSyncRequest = {
  id: Uint8Array;
  type: GraphSyncRequestType;
  pri: GraphSyncPriority;
  root: CID;
  sel: SelectorNode;
  ext?: GraphSyncExtensions;
};

export type GraphSyncResponse = {
  reqid: Uint8Array;
  stat: ResponseStatusCode;
  meta?: GraphSyncMetadata;
  ext?: GraphSyncExtensions;
};

export type GraphSyncMessage = {
  req?: GraphSyncRequest[];
  rsp?: GraphSyncResponse[];
  blk?: GraphSyncBlock[];
};

export type GraphSyncMessageRoot = {
  gs2: GraphSyncMessage;
};

export function newRequest(
  id: string,
  root: CID,
  sel: SelectorNode,
  ext?: GraphSyncExtensions
): Uint8ArrayList {
  const req: GraphSyncRequest = {
    id: uuidParse(id) as Uint8Array,
    type: GraphSyncRequestType.New,
    pri: 0,
    root,
    sel,
  };
  if (ext) {
    req.ext = ext;
  }
  return encode.single(
    Buffer.from(
      dagCBOR.encode<GraphSyncMessageRoot>({
        gs2: {
          req: [req],
        },
      })
    )
  );
}

export function decodeMessage(bytes: Uint8Array): GraphSyncMessage {
  return (dagCBOR.decode(bytes) as GraphSyncMessageRoot).gs2;
}

export async function decodeBlock(
  block: GraphSyncBlock,
  hashers: {[key: number]: hasher.MultihashHasher<any>}
): Promise<Block<any, any, any, any>> {
  let offset = 0;
  const cidVersion = varint.decode(block[0], offset) as any;
  offset += varint.decode.bytes;
  const multicodec = varint.decode(block[0], offset);
  offset += varint.decode.bytes;
  const multihash = varint.decode(block[0], offset);
  const hasher = hashers[multihash];
  if (!hasher) {
    throw new Error("Unsuported hasher");
  }
  const hash = await hasher.digest(block[1]);
  const cid = CID.create(cidVersion, multicodec, hash);
  const decode = decoderFor(cid);
  const value = decode ? decode(block[1]) : block[1];
  return new Block({value, cid, bytes: block[1]});
}
