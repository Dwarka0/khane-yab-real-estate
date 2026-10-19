import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1); raw[row] = 0;
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const inside = (x, y, points) => {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
};
function artwork(size, background, transparent = false) {
  const scale = size / 1024;
  const roof = [[180,470],[512,205],[844,470]];
  const body = [[270,445],[754,445],[754,820],[270,820]];
  const window1 = [[345,535],[455,535],[455,640],[345,640]];
  const window2 = [[569,535],[679,535],[679,640],[569,640]];
  const door = [[455,670],[569,670],[569,820],[455,820]];
  const bg = background;
  return (x0, y0) => {
    const x = x0 / scale, y = y0 / scale;
    const green = [29,91,68,255], white = [234,243,233,255];
    let color = transparent ? [0,0,0,0] : bg;
    if (inside(x,y,roof) || inside(x,y,body)) color = green;
    if (inside(x,y,window1) || inside(x,y,window2)) color = white;
    if (inside(x,y,door)) color = [18,64,49,255];
    return color;
  };
}
await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
const assets = new URL('../assets/', import.meta.url);
await writeFile(new URL('icon.png', assets), png(1024, 1024, artwork(1024, [234,243,233,255])));
await writeFile(new URL('adaptive-icon.png', assets), png(432, 432, artwork(432, [0,0,0,0], true)));
await writeFile(new URL('splash.png', assets), png(512, 512, artwork(512, [247,248,245,255])));
console.log('Generated icon.png, adaptive-icon.png, splash.png');
