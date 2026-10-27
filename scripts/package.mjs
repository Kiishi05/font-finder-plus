// Builds dist/ and zips it for the Chrome Web Store: release/font-finder-plus-<version>.zip
// No extra dependencies: a small zip writer using Node's zlib.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
execSync('node scripts/build.mjs', { cwd: root, stdio: 'inherit', env: { ...process.env, FFP_TEST: '' } });

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const bad = [];
if (manifest.key) bad.push('manifest has a "key" field');
if ((manifest.host_permissions ?? []).length) bad.push('manifest asks for host_permissions up front');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!e.name.startsWith('.') && !e.name.endsWith('.map')) files.push(p);
  }
})(dist);
for (const f of files) {
  if (!/\.(js|html|json)$/.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  if (/["'`]AIza[0-9A-Za-z_-]{35}["'`]/.test(s)) bad.push(`${path.relative(dist, f)} contains an API key`);
}
if (bad.length) {
  console.error('Not packaging:\n  ' + bad.join('\n  '));
  process.exit(1);
}

const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const local = [];
const central = [];
let offset = 0;
for (const f of files.sort()) {
  const name = Buffer.from(path.relative(dist, f).split(path.sep).join('/'));
  const data = fs.readFileSync(f);
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt32LE(0x00210000, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt32LE(0x00210000, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  local.push(h, name, packed);
  central.push(c, name);
  offset += h.length + name.length + packed.length;
}
const cdSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);

const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `font-finder-plus-${manifest.version}.zip`);
fs.writeFileSync(out, Buffer.concat([...local, ...central, end]));
console.log(`Packed ${files.length} files: ${path.relative(root, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
