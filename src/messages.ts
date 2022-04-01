import {CID, hasher} from "multiformats";
import {Block} from "multiformats/block";
import {Buffer} from "buffer";
import {parse as uuidParse} from "uuid";
import * as dagCBOR from "@ipld/dag-cbor";
import type BufferList from "bl/BufferList";
// @ts-ignore (no types)
import vd from "varint-decoder";
import lp from "it-length-prefixed";
import {SelectorNode, decoderFor} from "./traversal";

export const PROTOCOL = "/ipfs/graphsync/2.0.0";

export const DT_PROTOCOL = "/fil/datatransfer/1.1.0";

export type ChannelID = [string, string, number];

export type TransferMessage = {
  IsRq: boolean;
  Request?: TransferRequest;
  Response?: TransferResponse;
};

export type TransferRequest = {
  Type: number;
  XferID: number;
  BCid?: CID;
  Paus?: boolean;
  Part?: boolean;
  Pull?: boolean;
  Stor?: Uint8Array;
  Vouch?: any;
  VTyp?: string;
  RestartChannel?: ChannelID;
};

export type TransferResponse = {
  Type: number;
  Acpt: boolean;
  Paus: boolean;
  XferID: number;
  VRes: any;
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

enum GraphSyncLinkAction {
  Present = "p",
  DuplicateNotSent = "d",
  Missing = "m",
  DuplicateDAGSkipped = "s",
}

// prefix, data
export type GraphSyncBlock = [Uint8Array, Uint8Array];

type GraphSyncPriority = number;

type GraphSyncMetadatum = [CID, GraphSyncLinkAction];

type GraphSyncMetadata = GraphSyncMetadatum[];

enum GraphSyncRequestType {
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

type GraphSyncMessage = {
  req?: GraphSyncRequest[];
  rsp?: GraphSyncResponse[];
  blk?: GraphSyncBlock[];
};

type GraphSyncMessageRoot = {
  gs2: GraphSyncMessage;
};

export function newRequest(
  id: string,
  root: CID,
  sel: SelectorNode,
  ext?: GraphSyncExtensions
): BufferList {
  return lp.encode.single(
    new Buffer(
      dagCBOR.encode({
        gs2: {
          requests: [
            {
              id: uuidParse(id),
              type: GraphSyncRequestType.New,
              pri: 0,
              root,
              sel,
              ext,
            },
          ],
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
): Promise<Block<any>> {
  const values = vd(block[0]);
  const cidVersion = values[0];
  const multicodec = values[1];
  const multihash = values[2];
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
