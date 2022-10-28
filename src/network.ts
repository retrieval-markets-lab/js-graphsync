import type {PeerId} from "@libp2p/interface-peer-id";
import type {Multiaddr} from "@multiformats/multiaddr";
import type {
  StreamHandler,
  StreamHandlerOptions,
} from "@libp2p/interface-registrar";
import type {Stream} from "@libp2p/interface-connection";

export type Network = ProtocolDialer & Registrar & PeerAddressRegistrar;

// simplified version of the registrar
interface Registrar {
  handle: (
    protocol: string,
    handler: StreamHandler,
    options?: StreamHandlerOptions
  ) => Promise<void>;
  unhandle: (protocol: string) => Promise<void>;
}

export interface ProtocolDialer {
  dialProtocol: (
    peer: PeerId | Multiaddr,
    protocols: string | string[],
    options?: any
  ) => Promise<Stream>;
}

export interface PeerAddressRegistrar {
  peerStore: {
    addressBook: {
      add: (peer: PeerId, addrs: Multiaddr[]) => any;
    };
  };
}
