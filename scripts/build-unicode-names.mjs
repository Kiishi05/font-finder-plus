// Character names for the glyph viewer, from the Unicode Character Database
// (UnicodeData.txt, Unicode License v3). Writes public/data/unicode-names.json.gz.
// Names of CJK ideographs and Hangul syllables follow a rule and are made in code.
// Run: npm run build:unicode   (needs network)
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = await (await fetch('https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt')).text();
const names = {};
let n = 0;
for (const line of text.split('\n')) {
  const [hex, name] = line.split(';');
  if (!hex || !name || name.startsWith('<')) continue;
  const cp = parseInt(hex, 16);
  if (cp > 0x2ffff) continue;
  names[cp.toString(36)] = name;
  n++;
}
await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
await fs.writeFile(path.join(root, 'public/data/unicode-names.json.gz'), zlib.gzipSync(JSON.stringify(names), { level: 9 }));
await fs.writeFile(path.join(root, 'public/data/LICENSE-unicode.txt'), await (await fetch('https://www.unicode.org/license.txt')).text());
const size = (await fs.stat(path.join(root, 'public/data/unicode-names.json.gz'))).size;
console.log(`Wrote ${n} names, ${Math.round(size / 1024)} KB compressed.`);
