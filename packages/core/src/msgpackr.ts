// A MessagePack reader/writer compatible with the msgpackr settings NovelAI uses for story documents
// (`new Packr({ moreTypes: true, structuredClone: false })`):
//  - records: object key lists are defined once (`d4 72 <0x40|slot>` + key array, or `d5 72 <slot> <high>`)
//    and later objects reuse them with a single byte 0x40-0x7f (followed by a 0 byte when the slot has a
//    high-byte structure);
//  - maps decode to Map (records decode to plain objects);
//  - "write" extensions: `d4 <type> 00` followed by the wrapped value as ordinary MessagePack;
//  - Set: ext 115 written the same way around an array; Date: timestamp ext -1; undefined: `d4 00 00`.

/** A value wrapped by a "write" extension (NovelAI's Document, History, diffs…). */
export class Ext {
  constructor(
    public type: number,
    public value: unknown,
  ) {}
}

const WRITE_EXTENSIONS = new Set([20, 30, 31, 40, 41, 42, 101, 120]);

export function unpack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  let p = 0;
  // Structures by key: slot (0-63) or slot + (high << 5) for high-byte records.
  const structures = new Map<number, { keys: string[]; highByte?: number }>();
  const need = (n: number) => {
    if (p + n > bytes.length) throw new Error('msgpack: unexpected end of data');
  };
  const str = (n: number) => {
    need(n);
    const s = text.decode(bytes.subarray(p, p + n));
    p += n;
    return s;
  };
  const bin = (n: number) => {
    need(n);
    const b = bytes.slice(p, p + n);
    p += n;
    return b;
  };
  const u8 = () => {
    need(1);
    return bytes[p++];
  };
  const u16 = () => {
    need(2);
    p += 2;
    return view.getUint16(p - 2);
  };
  const u32 = () => {
    need(4);
    p += 4;
    return view.getUint32(p - 4);
  };
  const record = (keys: string[]) => {
    const o: Record<string, unknown> = {};
    for (const k of keys) o[k === '__proto__' ? '__proto_' : k] = read();
    return o;
  };
  const defineRecord = (slot: number, high?: number) => {
    const keys = (read() as unknown[]).map((k) => String(k));
    const key = high === undefined ? slot : slot < 32 ? -(slot + (high << 5)) : slot + (high << 5);
    structures.set(key, { keys, highByte: high });
    return record(keys);
  };
  const readRecordRef = (slot: number) => {
    const s = structures.get(slot);
    if (!s) return slot | 0x40; // no structure: it was a plain integer
    if (s.highByte === 0) {
      const high = u8();
      if (high !== 0) {
        const other = structures.get(slot < 32 ? -(slot + (high << 5)) : slot + (high << 5));
        if (!other) throw new Error(`msgpack: record ${slot}/${high} is not defined`);
        return record(other.keys);
      }
    }
    return record(s.keys);
  };
  const timestamp = (data: Uint8Array): Date => {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length === 4) return new Date(dv.getUint32(0) * 1000);
    if (data.length === 8) {
      const nsec = dv.getUint32(0) >>> 2;
      const sec = (dv.getUint32(0) & 3) * 4294967296 + dv.getUint32(4);
      return new Date(sec * 1000 + nsec / 1e6);
    }
    if (data.length === 12) return new Date(Number(dv.getBigInt64(4)) * 1000 + dv.getUint32(0) / 1e6);
    return new Date(NaN);
  };
  const ext = (n: number): unknown => {
    need(1);
    const type = view.getInt8(p++);
    if (n === 1 && type === 0) {
      p++;
      return undefined;
    }
    if (n === 1 && (WRITE_EXTENSIONS.has(type) || type === 115)) {
      p++; // filler byte; the wrapped value follows
      const inner = read();
      if (type === 115) return new Set(inner as unknown[]);
      return new Ext(type, inner);
    }
    const data = bin(n);
    if (type === -1) return timestamp(data);
    return new Ext(type, data);
  };
  const map = (n: number) => {
    const m = new Map<unknown, unknown>();
    for (let i = 0; i < n; i++) {
      const k = read();
      m.set(k, read());
    }
    return m;
  };
  const arr = (n: number) => Array.from({ length: n }, () => read());

  function read(): unknown {
    const b = u8();
    if (b < 0x40) return b;
    if (b < 0x80) return readRecordRef(b & 0x3f);
    if (b < 0x90) return map(b & 0x0f);
    if (b < 0xa0) return arr(b & 0x0f);
    if (b < 0xc0) return str(b & 0x1f);
    if (b >= 0xe0) return b - 0x100;
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bin(u8());
      case 0xc5: return bin(u16());
      case 0xc6: return bin(u32());
      case 0xc7: return ext(u8());
      case 0xc8: return ext(u16());
      case 0xc9: return ext(u32());
      case 0xca: need(4); p += 4; return view.getFloat32(p - 4);
      case 0xcb: need(8); p += 8; return view.getFloat64(p - 8);
      case 0xcc: return u8();
      case 0xcd: return u16();
      case 0xce: return u32();
      case 0xcf: need(8); p += 8; return Number(view.getBigUint64(p - 8));
      case 0xd0: need(1); p += 1; return view.getInt8(p - 1);
      case 0xd1: need(2); p += 2; return view.getInt16(p - 2);
      case 0xd2: need(4); p += 4; return view.getInt32(p - 4);
      case 0xd3: need(8); p += 8; return Number(view.getBigInt64(p - 8));
      case 0xd4:
        if (bytes[p] === 0x72) return p++, defineRecord(u8() & 0x3f);
        return ext(1);
      case 0xd5:
        if (bytes[p] === 0x72) {
          p++;
          const slot = u8() & 0x3f;
          return defineRecord(slot, u8());
        }
        return ext(2);
      case 0xd6: return ext(4);
      case 0xd7: return ext(8);
      case 0xd8: return ext(16);
      case 0xd9: return str(u8());
      case 0xda: return str(u16());
      case 0xdb: return str(u32());
      case 0xdc: return arr(u16());
      case 0xdd: return arr(u32());
      case 0xde: return map(u16());
      case 0xdf: return map(u32());
    }
    throw new Error(`msgpack: unknown byte 0x${b.toString(16)}`);
  }
  return read();
}

/**
 * Pack a value the way NovelAI's packer does: plain objects as records, Map as map, Set as ext 115,
 * Date as timestamp, `Ext` as a write-extension header followed by its value.
 */
export function pack(value: unknown): Uint8Array {
  let buf = new Uint8Array(4096);
  let view = new DataView(buf.buffer);
  let p = 0;
  const enc = new TextEncoder();
  const ensure = (n: number) => {
    if (p + n <= buf.length) return;
    let size = buf.length * 2;
    while (size < p + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(buf.subarray(0, p));
    buf = next;
    view = new DataView(buf.buffer);
  };
  const byte = (...bs: number[]) => {
    ensure(bs.length);
    for (const b of bs) buf[p++] = b;
  };
  // Record slots: key-list signature -> slot; slots are reused round-robin past 64 by redefining them.
  const slotOf = new Map<string, number>();
  const slotKeys: (string | null)[] = Array(64).fill(null);
  let nextSlot = 0;

  const num = (n: number) => {
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      // With records, 0x40-0x7f are record references, so 64-127 take a uint8.
      if (n < 64) byte(n);
      else if (n < 256) byte(0xcc, n);
      else if (n < 65536) byte(0xcd, n >> 8, n & 255);
      else {
        ensure(5);
        buf[p++] = 0xce;
        view.setUint32(p, n);
        p += 4;
      }
    } else if (Number.isInteger(n) && n < 0 && n >= -0x80000000) {
      if (n >= -32) byte(256 + n);
      else if (n >= -128) byte(0xd0, n + 256);
      else if (n >= -32768) {
        ensure(3);
        buf[p++] = 0xd1;
        view.setInt16(p, n);
        p += 2;
      } else {
        ensure(5);
        buf[p++] = 0xd2;
        view.setInt32(p, n);
        p += 4;
      }
    } else {
      ensure(9);
      buf[p++] = 0xcb;
      view.setFloat64(p, n);
      p += 8;
    }
  };
  const string = (s: string) => {
    const b = enc.encode(s);
    if (b.length < 32) byte(0xa0 | b.length);
    else if (b.length < 256) byte(0xd9, b.length);
    else if (b.length < 65536) byte(0xda, b.length >> 8, b.length & 255);
    else {
      ensure(5);
      buf[p++] = 0xdb;
      view.setUint32(p, b.length);
      p += 4;
    }
    ensure(b.length);
    buf.set(b, p);
    p += b.length;
  };
  const arrayHeader = (n: number) => {
    if (n < 16) byte(0x90 | n);
    else if (n < 65536) byte(0xdc, n >> 8, n & 255);
    else {
      ensure(5);
      buf[p++] = 0xdd;
      view.setUint32(p, n);
      p += 4;
    }
  };
  const mapHeader = (n: number) => {
    if (n < 16) byte(0x80 | n);
    else if (n < 65536) byte(0xde, n >> 8, n & 255);
    else {
      ensure(5);
      buf[p++] = 0xdf;
      view.setUint32(p, n);
      p += 4;
    }
  };
  const date = (d: Date) => {
    const ms = d.getTime();
    const sec = Math.floor(ms / 1000);
    const nsec = (ms - sec * 1000) * 1e6;
    if (nsec === 0 && sec >= 0 && sec < 4294967296) {
      ensure(6);
      buf[p++] = 0xd6;
      buf[p++] = 0xff;
      view.setUint32(p, sec);
      p += 4;
    } else if (sec >= 0 && sec < 4294967296 * 4) {
      ensure(10);
      buf[p++] = 0xd7;
      buf[p++] = 0xff;
      view.setUint32(p, nsec * 4 + Math.floor(sec / 4294967296));
      view.setUint32(p + 4, sec >>> 0);
      p += 8;
    } else {
      ensure(15);
      byte(0xc7, 12, 0xff);
      view.setUint32(p, nsec);
      view.setBigInt64(p + 4, BigInt(sec));
      p += 12;
    }
  };
  const write = (v: unknown): void => {
    if (v === null) return byte(0xc0);
    if (v === undefined) return byte(0xd4, 0, 0);
    if (v === true) return byte(0xc3);
    if (v === false) return byte(0xc2);
    if (typeof v === 'number') return num(v);
    if (typeof v === 'string') return string(v);
    if (typeof v === 'bigint') return num(Number(v));
    if (v instanceof Ext) {
      byte(0xd4, v.type, 0);
      return write(v.value);
    }
    if (v instanceof Date) return date(v);
    if (v instanceof Set) {
      byte(0xd4, 115, 0);
      const items = [...v];
      arrayHeader(items.length);
      for (const x of items) write(x);
      return;
    }
    if (v instanceof Map) {
      mapHeader(v.size);
      for (const [k, x] of v) {
        write(k);
        write(x);
      }
      return;
    }
    if (v instanceof Uint8Array) {
      if (v.length < 256) byte(0xc4, v.length);
      else {
        ensure(5);
        buf[p++] = 0xc6;
        view.setUint32(p, v.length);
        p += 4;
      }
      ensure(v.length);
      buf.set(v, p);
      p += v.length;
      return;
    }
    if (Array.isArray(v)) {
      arrayHeader(v.length);
      for (const x of v) write(x);
      return;
    }
    if (typeof v === 'object') {
      // Like msgpackr, keys whose value is undefined are kept (written as `d4 00 00`).
      const keys = Object.keys(v as object);
      const sig = JSON.stringify(keys);
      const slot = slotOf.get(sig);
      if (slot !== undefined && slotKeys[slot] === sig) byte(0x40 | slot);
      else {
        const s = nextSlot;
        nextSlot = (nextSlot + 1) % 64;
        const old = slotKeys[s];
        if (old) slotOf.delete(old);
        slotKeys[s] = sig;
        slotOf.set(sig, s);
        byte(0xd4, 0x72, 0x40 | s);
        arrayHeader(keys.length);
        for (const k of keys) string(k);
      }
      for (const k of keys) write((v as Record<string, unknown>)[k]);
      return;
    }
    throw new Error(`msgpack: cannot pack ${typeof v}`);
  };
  write(value);
  return buf.slice(0, p);
}
