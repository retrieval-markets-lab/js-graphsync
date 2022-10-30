import * as React from "react";
import {useState, useEffect} from "react";
import * as ReactDOM from "react-dom";
import {Noise} from "@chainsafe/libp2p-noise";
import {createLibp2p, Libp2p} from "libp2p";
import {fetch, push, GraphSync} from "@dcdn/graphsync";
import {Cachestore} from "cache-blockstore";
import type {Store} from "interface-store";
import type {CID} from "multiformats";
import {multiaddr} from "@multiformats/multiaddr";
import {yamux} from "@chainsafe/libp2p-yamux";
import {webSockets} from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import {useDropzone} from "react-dropzone";
import {importer} from "ipfs-unixfs-importer";

const CID_KEY = "/cid/default";
const ADDR_KEY = "/maddr/default";
const MAX_CHUNK_SIZE = 262144;

function fileIterator(file: File): AsyncIterable<Uint8Array> {
  let index = 0;

  const iterator = {
    next: (): Promise<IteratorResult<Uint8Array>> => {
      if (index > file.size) {
        return Promise.resolve({
          done: true,
          value: null,
        });
      }

      return new Promise((resolve, reject) => {
        const chunk = file.slice(index, (index += MAX_CHUNK_SIZE));

        const reader = new global.FileReader();

        const handleLoad = (ev) => {
          // @ts-ignore No overload matches this call.
          reader.removeEventListener("loadend", handleLoad, false);

          if (ev.error) {
            return reject(ev.error);
          }

          resolve({
            done: false,
            value: new Uint8Array(reader.result as ArrayBuffer),
          });
        };

        // @ts-ignore No overload matches this call.
        reader.addEventListener("loadend", handleLoad);
        reader.readAsArrayBuffer(chunk);
      });
    },
  };

  return {
    [Symbol.asyncIterator]: () => {
      return iterator;
    },
  };
}

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
  store: Store<CID, Uint8Array>;
  constructor(net: Libp2p, store: Store<CID, Uint8Array>) {
    this.store = store;
    this.exchange = new GraphSync(net, store);
    this.exchange.start();
  }
  fetch(path: string, maddr: string): Promise<Response> {
    const peerAddr = multiaddr(maddr);
    return fetch(path, {
      exchange: this.exchange,
      headers: {},
      provider: peerAddr,
      voucher: ["any"],
      voucherType: "BasicVoucher",
    });
  }
  push(path: string, maddr: string): Promise<void> {
    const peerAddr = multiaddr(maddr);
    return push(path, {
      exchange: this.exchange,
      maddr: peerAddr,
      voucher: ["any"],
      voucherType: "BasicVoucher",
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
  const [uproot, setUproot] = useState<CID | null>(null);

  const onDrop = async (files: File[]) => {
    if (!client) {
      console.error("not client initialized");
      return;
    }
    for await (const chunk of importer(
      files.map((f) => ({path: f.name, content: fileIterator(f)})),
      client.store,
      {
        cidVersion: 1,
        rawLeaves: true,
        wrapWithDirectory: true,
      }
    )) {
      console.log(chunk);
      if (chunk.path === "") {
        setUproot(chunk.cid);
      }
    }
  };

  const {getRootProps, getInputProps, isDragActive} = useDropzone({onDrop});

  const disabled = !root || !maddr || loading;

  function upload() {
    if (!client || !uproot) {
      return;
    }
    console.log("uploading");
    client
      .push(uproot.toString(), maddr)
      .then(() => console.log("uploaded"))
      .catch(console.error);
  }
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
      transports: [webSockets({filter: filters.all})],
      connectionEncryption: [() => new Noise()],
      streamMuxers: [yamux()],
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
      <div {...getRootProps({className: "drp"})}>
        <input {...getInputProps()} />
        {uproot ? (
          <p>{uproot.toString()}</p>
        ) : (
          <p>Drag or click to add files</p>
        )}
      </div>
      <button className="btn" onClick={upload}>
        upload
      </button>
    </div>
  );
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById("root")
);
