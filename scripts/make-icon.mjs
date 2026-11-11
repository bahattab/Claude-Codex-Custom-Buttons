// Draws the project icon (512x512 PNG): a rounded indigo square holding a row of three
// white "buttons", the widest one first. Run: node scripts/make-icon.mjs <out.png>...
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const S = 512;
const k = S / 256; // the drawing below is in 256-unit coordinates
const px = Buffer.alloc(S * S * 4);
const inRounded = (x, y, ...box) => inBox(x / k, y / k, ...box);
const inBox = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = x < x0 + r ? x0 + r : x >= x1 - r ? x1 - r - 1 : x;
  const cy = y < y0 + r ? y0 + r : y >= y1 - r ? y1 - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const buttons = [
  [40, 92, 140, 164],
  [152, 92, 216, 164],
  [40, 176, 216, 204],
];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!inRounded(x, y, 0, 0, 256, 256, 48)) continue; // transparent corners
    let [r, g, b] = [79, 70, 229]; // indigo #4F46E5
    if (inRounded(x, y, 40, 40, 216, 76, 10)) [r, g, b] = [199, 210, 254]; // the prompt box
    for (const [x0, y0, x1, y1] of buttons) if (inRounded(x, y, x0, y0, x1, y1, 12)) [r, g, b] = [255, 255, 255];
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
}
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
for (const out of process.argv.slice(2)) writeFileSync(out, png);
