import * as React from "react";
import {useState, useEffect} from "react";
import * as ReactDOM from "react-dom";
import {Noise} from "@chainsafe/libp2p-noise";
import {create as createLibp2p, Libp2p} from "libp2p";
import {fetch, GraphSync} from "@dcdn/graphsync";
import {Cachestore} from "@dcdn/cachestore";
import type {Store} from "interface-store";
import type {CID} from "multiformats";
import {Multiaddr} from "multiaddr";
import filters from "libp2p-websockets/src/filters";
import WebSockets from "libp2p-websockets";
import Mplex from "libp2p-mplex";

const CID_KEY = "/cid/default";
const ADDR_KEY = "/maddr/default";

function Spinner() {
  return (
    <div className="spin" role="progressbar">
      <svg height="100%" viewBox="0 0 32 32" width="100%">
        <circle
          cx="16"
          cy="16"
          fill="none"
          r="14"
          strokeWidth="4"
          style={{
            stroke: "#000",
            opacity: 0.2,
          }}
        />
        <circle
          cx="16"
          cy="16"
          fill="none"
          r="14"
          strokeWidth="4"
          style={{
            stroke: "#000",
            strokeDasharray: 80,
            strokeDashoffset: 60,
          }}
        />
      </svg>
    </div>
  );
}

class Client {
  exchange: GraphSync;
  constructor(net: Libp2p, store: Store<CID, Uint8Array>) {
    this.exchange = new GraphSync(net, store);
    this.exchange.start();
  }
  fetch(path: string, maddr: string): Promise<Response> {
    const peerAddr = new Multiaddr(maddr);
    return fetch(path, {
      exchange: this.exchange,
      headers: {},
      provider: peerAddr,
    });
  }
}

function App() {
  const [root, setRoot] = useState(localStorage.getItem(CID_KEY) ?? "");
  const [maddr, setMaddr] = useState(localStorage.getItem(ADDR_KEY) ?? "");
  const [img, setImg] = useState("");
  const [vid, setVid] = useState("");
  const [loading, setLoading] = useState(false);
  const [client, setClient] = useState<Client | null>(null);

  const disabled = !root || !maddr || loading;

  function sendRequest() {
    if (disabled || !client) {
      return;
    }
    setLoading(true);
    localStorage.setItem(CID_KEY, root);
    localStorage.setItem(ADDR_KEY, maddr);
    const start = performance.now();
    client
      .fetch(root, maddr)
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        setLoading(false);
        if (/image/.test(blob.type)) {
          setImg(url);
        }
        if (/video/.test(blob.type)) {
          setVid(url);
        }
        const done = performance.now();
        const duration = done - start;
        console.log(`done in ${duration}ms (${blob.size / duration}bps)`);
      })
      .catch(console.error);
  }
  async function createClient(): Promise<Client> {
    const blocks = new Cachestore("/graphsync/blocks");
    await blocks.open();

    const libp2p = await createLibp2p({
      modules: {
        transport: [WebSockets],
        connEncryption: [new Noise()],
        streamMuxer: [Mplex],
      },
      config: {
        transport: {
          [WebSockets.prototype[Symbol.toStringTag]]: {
            filter: filters.all,
          },
        },
        peerDiscovery: {
          autoDial: false,
        },
      },
    });
    await libp2p.start();
    return new Client(libp2p, blocks);
  }
  useEffect(() => {
    createClient().then((client) => setClient(client));
  }, []);
  return (
    <div className="app">
      {img ? (
        <img className="img" src={img} alt="Retrieved image" />
      ) : vid ? (
        <video controls className="img" autoPlay loop>
          <source src={vid} type="video/mp4" />
        </video>
      ) : (
        <div className="img">{loading && <Spinner />}</div>
      )}
      <input
        id="root"
        type="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="root CID"
        className="ipt"
        value={root}
        onChange={(e) => setRoot(e.target.value)}
      />
      <input
        id="maddr"
        type="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="multi address"
        className="ipt"
        value={maddr}
        onChange={(e) => setMaddr(e.target.value)}
      />
      <button className="btn" onClick={sendRequest} disabled={disabled}>
        request
      </button>
      <p className="p">{!!client && "wasm loaded"}</p>
    </div>
  );
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById("root")
);
