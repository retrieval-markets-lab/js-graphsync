import type {MuxedStream, HandlerProps} from "libp2p";
import type PeerId from "peer-id";
import type {Multiaddr} from "multiaddr";

export type Network = ProtocolDialer &
  ProtocolHandlerRegistrar &
  PeerAddressRegistrar;

export interface ProtocolDialer {
  dialProtocol: (
    peer: PeerId,
    protocols: string[] | string,
    options?: any
  ) => Promise<{stream: MuxedStream; protocol: string}>;
}

export interface ProtocolHandlerRegistrar {
  handle: (protocol: string, handler: (props: HandlerProps) => void) => void;
  unhandle: (protocol: string | string[]) => void;
}

export interface PeerAddressRegistrar {
  peerStore: {
    addressBook: {
      add: (peer: PeerId, addrs: Multiaddr[]) => any;
    };
  };
}
