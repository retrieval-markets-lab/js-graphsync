import {Buffer} from "buffer";
// detectContentType implements the algorithm described at
// http://mimesniff.spec.whatwg.org/ to determine the Content-Type of the given
// data. It considers at most the first 512 bytes of data.
//
// detectContentType always returns a valid MIME type: if it cannot determine a
// more specific one, it returns "application/octet-stream".
export function detectContentType(content: Uint8Array): string {
  const data = content.slice(0, 512);

  let firstNonWS = 0;
  while (firstNonWS < data.length && isWS(data[firstNonWS])) {
    firstNonWS++;
  }

  for (let sig of sniffSignatures) {
    let ct = sig.match(data, firstNonWS);
    if (ct != "") {
      return ct;
    }
  }
  return "application/octet-stream"; // fallback
}

function isWS(b: number) {
  switch (b) {
    case "\t".charCodeAt(0):
    case "\n".charCodeAt(0):
    case ",0x0c".charCodeAt(0):
    case "\r".charCodeAt(0):
    case " ".charCodeAt(0):
      return true;
  }
  return false;
}

class exactSig {
  sig: Buffer;
  ct: string;
  constructor(sig: Buffer, ct: string) {
    this.sig = sig;
    this.ct = ct;
  }

  match(data: Uint8Array): string {
    if (Buffer.compare(this.sig, data.slice(0, this.sig.length)) == 0) {
      return this.ct;
    }
    return "";
  }
}

class maskedSig {
  ct: string;
  skipWS: boolean;
  pat: Buffer;
  mask: Buffer;
  constructor(mask: Buffer, pat: Buffer, skipWS: boolean, ct: string) {
    this.mask = mask;
    this.pat = pat;
    this.skipWS = skipWS;
    this.ct = ct;
  }

  match(data: Uint8Array, firstNonWS: number) {
    if (this.skipWS) {
      data = data.slice(firstNonWS);
    }
    if (this.pat.length != this.mask.length) {
      return "";
    }
    if (data.length < this.mask.length) {
      return "";
    }
    for (let i = 0; i < this.mask.length; i++) {
      let db = data[i] & this.mask[i];
      if (db != this.pat[i]) {
        return "";
      }
    }
    return this.ct;
  }
}

class htmlSig {
  h: Buffer;
  constructor(h: string) {
    this.h = Buffer.from(h);
  }

  match(data: Uint8Array, firstNonWS: number) {
    data = data.slice(firstNonWS);
    if (data.length < this.h.length + 1) {
      return "";
    }

    for (let i = 0; i < this.h.length; i++) {
      let b = this.h[i];
      let db = data[i];
      if ("A".charCodeAt(0) <= b && b <= "Z".charCodeAt(0)) {
        db &= 0xdf;
      }
      if (b != db) {
        return "";
      }
    }
    // Next byte must be space or right angle bracket.
    let db = String.fromCharCode(data[this.h.length]);
    if (db != " " && db != ">") {
      return "";
    }
    return "text/html; charset=utf-8";
  }
}

// Does not follow the official specs but useful anyways for displaying image instead of markup
class svgSig {
  h = Buffer.from("<svg");
  match(data: Uint8Array, firstNonWS: number) {
    data = data.slice(firstNonWS);
    if (data.length < this.h.length + 1) {
      return "";
    }

    for (let i = 0; i < this.h.length; i++) {
      let b = this.h[i];
      let db = data[i];
      if ("A".charCodeAt(0) <= b && b <= "Z".charCodeAt(0)) {
        db &= 0xdf;
      }
      if (b != db) {
        return "";
      }
    }
    // Next byte must be space or right angle bracket.
    let db = String.fromCharCode(data[this.h.length]);
    if (db != " " && db != ">") {
      return "";
    }
    return "image/svg+xml";
  }
}

let mp4ftype = Buffer.from("ftyp");
let mp4 = Buffer.from("mp4");

class mp4Sig {
  match(data: Uint8Array) {
    const buf = Buffer.from(data);
    // https://mimesniff.spec.whatwg.org/#signature-for-mp4
    // c.f. section 6.2.1
    if (buf.length < 12) {
      return "";
    }
    let boxSize = buf.readUInt32BE(0);
    if (boxSize % 4 != 0 || buf.length < boxSize) {
      return "";
    }
    if (Buffer.compare(buf.slice(4, 8), mp4ftype) != 0) {
      return "";
    }
    for (let st = 8; st < boxSize; st += 4) {
      if (st == 12) {
        // minor version number
        continue;
      }
      if (Buffer.compare(buf.slice(st, st + 3), mp4) == 0) {
        return "video/mp4";
      }
    }
    return "";
  }
}

class textSig {
  match(data: Uint8Array, firstNonWS: number) {
    // c.f. section 5, step 4
    for (let b of data.slice(firstNonWS)) {
      if (
        b <= 0x08 ||
        b == 0x0b ||
        (0x0e <= b && b <= 0x1a) ||
        (0x1c <= b && b <= 0x1f)
      ) {
        return "";
      }
    }
    return "text/plain; charset=utf-8";
  }
}

const sniffSignatures = [
  new htmlSig("<!DOCTYPE HTML"),
  new htmlSig("<HTML"),
  new htmlSig("<HEAD"),
  new htmlSig("<SCRIPT"),
  new htmlSig("<IFRAME"),
  new htmlSig("<H1"),
  new htmlSig("<DIV"),
  new htmlSig("<FONT"),
  new htmlSig("<TABLE"),
  new htmlSig("<A"),
  new htmlSig("<STYLE"),
  new htmlSig("<TITLE"),
  new htmlSig("<B"),
  new htmlSig("<BODY"),
  new htmlSig("<BR"),
  new htmlSig("<P"),
  new htmlSig("<!--"),

  new svgSig(),

  new maskedSig(
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.from("<?xml"),
    true,
    "text/xml; charset=utf-8"
  ),

  new exactSig(Buffer.from("%PDF-"), "application/pdf"),
  new exactSig(Buffer.from("%!PS-Adobe-"), "application/postscript"),

  // UTF BOMs.
  new maskedSig(
    Buffer.from([0xff, 0xff, 0x00, 0x00]),
    Buffer.from([0xfe, 0xff, 0x00, 0x00]),
    false,
    "text/plain; charset=utf-16be"
  ),
  new maskedSig(
    Buffer.from([0xff, 0xff, 0x00, 0x00]),
    Buffer.from([0xff, 0xfe, 0x00, 0x00]),
    false,
    "text/plain; charset=utf-16le"
  ),
  new maskedSig(
    Buffer.from([0xff, 0xff, 0xff, 0x00]),
    Buffer.from([0xef, 0xbb, 0xbf, 0x00]),
    false,
    "text/plain; charset=utf-8"
  ),

  new exactSig(Buffer.from("GIF87a"), "image/gif"),
  new exactSig(Buffer.from("GIF89a"), "image/gif"),
  new exactSig(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/png"
  ),
  new exactSig(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"),
  new exactSig(Buffer.from("BM"), "image/bmp"),
  new maskedSig(
    Buffer.from([
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
      0xff, 0xff,
    ]),
    Buffer.from("RIFF\x00\x00\x00\x00WEBPVP"),
    false,
    "image/webp"
  ),
  new exactSig(
    Buffer.from([0x00, 0x00, 0x01, 0x00]),
    "image/vnd.microsoft.icon"
  ),

  new maskedSig(
    Buffer.from([
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ]),
    Buffer.from("RIFF\x00\x00\x00\x00WAVE"),
    false,
    "audio/wave"
  ),
  new maskedSig(
    Buffer.from([
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ]),
    Buffer.from("FORM\x00\x00\x00\x00AIFF"),
    false,
    "audio/aiff"
  ),
  new maskedSig(
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from(".snd"),
    false,
    "audio/basic"
  ),
  new maskedSig(
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.from("OggS\x00"),
    false,
    "application/ogg"
  ),
  new maskedSig(
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.concat([Buffer.from("MThd"), Buffer.from([0x00, 0x00, 0x00, 0x06])]),
    false,
    "audio/midi"
  ),
  new maskedSig(
    Buffer.from([0xff, 0xff, 0xff]),
    Buffer.from("ID3"),
    false,
    "audio/mpeg"
  ),

  new maskedSig(
    Buffer.from([
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ]),
    Buffer.from("RIFF\x00\x00\x00\x00AVI "),
    false,
    "video/avi"
  ),
  new exactSig(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "video/webm"),

  new exactSig(
    Buffer.from([0x52, 0x61, 0x72, 0x20, 0x1a, 0x07, 0x00]),
    "application/x-rar-compressed"
  ),
  new exactSig(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "application/zip"),
  new exactSig(Buffer.from([0x1f, 0x8b, 0x08]), "application/x-gzip"),
  new mp4Sig(),
  new textSig(), // should be last
];
