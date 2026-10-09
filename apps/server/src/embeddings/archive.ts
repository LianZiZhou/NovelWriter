// Unpacking the archives runtimes and llama.cpp builds come in (.tar.gz, .zip, .nupkg), without dependencies.
import { createReadStream, createWriteStream, closeSync, mkdirSync, openSync, symlinkSync, writeSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createInflateRaw } from 'node:zlib';

/** `dest/name`, refusing names that would land outside `dest`. */
function inside(dest: string, name: string): string {
  const clean = normalize(name.replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
  if (!clean || isAbsolute(clean) || clean.split(/[\\/]/).includes('..')) throw new Error(`Unsafe path in archive: ${name}`);
  return join(dest, clean);
}

export interface ExtractOptions {
  /** Leading path components to drop (npm tarballs put everything under `package/`). */
  strip?: number;
  /** Return false to skip an entry (after stripping). */
  filter?: (name: string) => boolean;
}

function stripName(name: string, strip = 0): string | null {
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= strip) return null;
  return parts.slice(strip).join('/');
}

/** Extract a gzip-compressed tar file, streaming. Handles GNU long names, pax headers and symlinks. */
export async function extractTarGz(file: string, dest: string, opts: ExtractOptions = {}): Promise<string[]> {
  mkdirSync(dest, { recursive: true });
  const written: string[] = [];
  let buf: Buffer = Buffer.alloc(0);
  let fd: number | null = null;
  let remaining = 0;
  let padding = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  let paxLink: string | null = null;
  let meta: { type: string; size: number; data: Buffer[] } | null = null;
  const links: { target: string; path: string; hard: boolean }[] = [];

  const header = (h: Buffer) => {
    const str = (a: number, b: number) => h.subarray(a, a + b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const prefix = h.subarray(257, 262).toString() === 'ustar' ? str(345, 155) : '';
    const rawName = longName ?? paxPath ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    const link = paxLink ?? str(157, 100);
    const mode = parseInt(str(100, 8).trim() || '644', 8);
    longName = paxPath = paxLink = null;
    return { size, type, name: rawName, link, mode };
  };

  const startEntry = (e: ReturnType<typeof header>) => {
    remaining = e.size;
    padding = (512 - (e.size % 512)) % 512;
    if (e.type === 'L' || e.type === 'x' || e.type === 'g' || e.type === 'K') {
      meta = { type: e.type, size: e.size, data: [] };
      return;
    }
    const name = stripName(e.name, opts.strip);
    if (!name || (opts.filter && !opts.filter(name))) return;
    const path = inside(dest, name);
    if (e.type === '5') {
      mkdirSync(path, { recursive: true });
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    if (e.type === '2' || e.type === '1') {
      const target = e.type === '1' ? stripName(e.link, opts.strip) : e.link;
      if (target) links.push({ target, path, hard: e.type === '1' });
      return;
    }
    if (e.type !== '0' && e.type !== '7') return;
    rmSync(path, { force: true });
    fd = openSync(path, 'w', e.mode & 0o777 ? e.mode & 0o777 | 0o600 : 0o644);
    written.push(name);
  };

  const finishMeta = () => {
    if (!meta) return;
    const data = Buffer.concat(meta.data).toString('utf8');
    if (meta.type === 'L') longName = data.replace(/\0.*$/s, '');
    else if (meta.type === 'x') {
      for (const m of data.matchAll(/\d+ (\w+)=([^\n]*)\n/g)) {
        if (m[1] === 'path') paxPath = m[2];
        if (m[1] === 'linkpath') paxLink = m[2];
      }
    }
    meta = null;
  };

  const consume = (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    let at = 0;
    while (true) {
      if (remaining > 0) {
        const n = Math.min(remaining, buf.length - at);
        if (n <= 0) break;
        const piece = buf.subarray(at, at + n);
        if (fd !== null) writeSync(fd, piece);
        else if (meta) meta.data.push(Buffer.from(piece));
        at += n;
        remaining -= n;
        if (remaining > 0) break;
      }
      if (remaining === 0 && (fd !== null || meta)) {
        if (fd !== null) closeSync(fd);
        fd = null;
        finishMeta();
      }
      if (padding > 0) {
        const n = Math.min(padding, buf.length - at);
        at += n;
        padding -= n;
        if (padding > 0) break;
      }
      if (buf.length - at < 512) break;
      const h = buf.subarray(at, at + 512);
      at += 512;
      if (h.every((b) => b === 0)) continue;
      const e = header(h);
      startEntry(e);
      if (e.size === 0 && meta) finishMeta();
    }
    buf = buf.subarray(at);
  };

  try {
    const gunzip = createReadStream(file).pipe(createGunzip());
    for await (const chunk of gunzip) consume(chunk as Buffer);
  } finally {
    if (fd !== null) closeSync(fd);
  }
  for (const l of links) {
    rmSync(l.path, { force: true });
    if (l.hard) {
      copyFileSync(inside(dest, l.target), l.path);
      continue;
    }
    // Only links that stay inside the extracted tree.
    const resolved = join(dirname(l.path), l.target);
    if (isAbsolute(l.target) || relative(dest, resolved).split(sep).includes('..')) continue;
    try {
      symlinkSync(l.target, l.path);
    } catch {
      try {
        copyFileSync(resolved, l.path);
      } catch {
        /* target missing */
      }
    }
  }
  return written;
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  external: number;
}

async function zipEntries(file: string): Promise<ZipEntry[]> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
    if (eocd < 0) throw new Error('Not a zip file');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    // Zip64: the end-of-central-directory locator sits right before the record.
    if ((cdOffset === 0xffffffff || count === 0xffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const recOffset = Number(tail.readBigUInt64LE(eocd - 12));
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, 56, recOffset);
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const out: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count && cd.readUInt32LE(p) === 0x02014b50; i++) {
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let sz = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const external = cd.readUInt32LE(p + 38);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (sz === 0xffffffff) (sz = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (compressedSize === 0xffffffff) (compressedSize = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (localOffset === 0xffffffff) localOffset = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      out.push({ name, method, compressedSize, size: sz, localOffset, external });
      p = end + commentLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Extract a zip file (stored or deflated entries, Zip64), streaming each entry. */
export async function extractZip(file: string, dest: string, opts: ExtractOptions = {}): Promise<string[]> {
  mkdirSync(dest, { recursive: true });
  const written: string[] = [];
  const entries = await zipEntries(file);
  const fh = await open(file, 'r');
  try {
    for (const e of entries) {
      const name = stripName(e.name, opts.strip);
      if (!name || e.name.endsWith('/') || (opts.filter && !opts.filter(name))) continue;
      const path = inside(dest, name);
      mkdirSync(dirname(path), { recursive: true });
      const local = Buffer.alloc(30);
      await fh.read(local, 0, 30, e.localOffset);
      const start = e.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const src = createReadStream('', { fd: fh.fd, autoClose: false, start, end: start + e.compressedSize - 1 });
      const out = createWriteStream(path);
      if (e.compressedSize === 0) {
        src.destroy();
        out.end();
        await new Promise<void>((r) => out.on('close', () => r()));
      } else if (e.method === 0) await pipeline(src, out);
      else if (e.method === 8) await pipeline(src, createInflateRaw(), out);
      else throw new Error(`Unsupported zip compression method ${e.method} for ${e.name}`);
      // Unix permissions, when the archive was made on a Unix system.
      const mode = (e.external >>> 16) & 0o777;
      if (mode) chmodSync(path, mode | 0o600);
      written.push(name);
    }
  } finally {
    await fh.close();
  }
  return written;
}

export function extractArchive(file: string, dest: string, opts?: ExtractOptions): Promise<string[]> {
  return /\.(zip|nupkg)$/i.test(file) ? extractZip(file, dest, opts) : extractTarGz(file, dest, opts);
}
