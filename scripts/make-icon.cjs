// Uso: node scripts/make-icon.cjs media/icon.png
// Genera media/icon.png (128x128) sin dependencias: escena vectorial simple
// (dos tarjetas de tabla unidas por una línea ortogonal sobre un fondo
// redondeado), muestreada 4x4 por píxel y codificada como PNG RGBA.
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const OUT = process.argv[2];
const W = 128, H = 128, SS = 6;

const BG = [32, 71, 158];       // #20479e
const CARD = [255, 255, 255];
const HEAD1 = [239, 108, 0];    // #ef6c00
const HEAD2 = [46, 125, 50];    // #2e7d32
const ROW = [226, 232, 240];
const LINE = [255, 255, 255];

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// tarjetas: una arriba a la izquierda, otra abajo a la derecha, con canal
// libre debajo de la primera para que la pata de gallo tenga sitio
const C1 = { x0: 14, y0: 16, x1: 58, y1: 60 };
const C2 = { x0: 70, y0: 68, x1: 114, y1: 112 };
const HEADH = 13;
const RADIUS = 5;

function card(x, y, c, head) {
  if (!inRoundRect(x, y, c.x0, c.y0, c.x1, c.y1, RADIUS)) return null;
  if (y <= c.y0 + HEADH) return head;
  const rel = y - (c.y0 + HEADH);
  const row = rel % 11;
  if (row > 9.4 && x > c.x0 + 2 && x < c.x1 - 2) return ROW;
  if (row > 3 && row < 7 && x > c.x0 + 5 && x < c.x0 + 5 + 14) return ROW;
  return CARD;
}

// conector: sale de C1 por abajo, baja, gira con esquina redondeada y entra a
// C2 por la izquierda. Extremo "uno" (barra) en C1, "muchos" (pata de gallo
// abierta hacia la tabla) en C2.
const LW = 2.6;
const VX = 36;      // x del tramo vertical
const HY = 90;      // y del tramo horizontal
const R = 6;        // radio de la esquina
const P = [
  [VX, C1.y1], [VX, HY - R],
  [VX + R, HY], [C2.x0, HY],
];
function nearSeg(x, y, a, b) {
  const [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((x - ax) * dx + (y - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx, py = ay + t * dy;
  return Math.hypot(x - px, y - py) <= LW / 2;
}
// cuarto de arco de la esquina: centro (VX+R, HY-R), cuadrante inferior izquierdo
function nearCorner(x, y) {
  const cx = VX + R, cy = HY - R;
  if (x > cx || y < cy) return false;
  return Math.abs(Math.hypot(x - cx, y - cy) - R) <= LW / 2;
}
function onLine(x, y) {
  if (nearSeg(x, y, P[0], P[1]) || nearSeg(x, y, P[2], P[3]) || nearCorner(x, y)) return true;
  // pata de gallo en C2: tres puntas que se abren hacia la tabla
  const ex = C2.x0, ey = HY, L = 11, S = 7;
  for (const d of [-S, 0, S]) if (nearSeg(x, y, [ex - L, ey], [ex, ey + d])) return true;
  // barra "uno" bajo C1, perpendicular al tramo vertical
  if (nearSeg(x, y, [VX - 6, C1.y1 + 7], [VX + 6, C1.y1 + 7])) return true;
  return false;
}

function shade(x, y) {
  if (!inRoundRect(x, y, 0.5, 0.5, W - 0.5, H - 0.5, 26)) return [0, 0, 0, 0];
  if (onLine(x, y)) return [...LINE, 255];
  const c2 = card(x, y, C2, HEAD2);
  if (c2) return [...c2, 255];
  const c1 = card(x, y, C1, HEAD1);
  if (c1) return [...c1, 255];
  return [...BG, 255];
}

const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const [cr, cg, cb, ca] = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
      }
    const n = SS * SS;
    const i = (y * W + x) * 4;
    if (a > 0) {
      px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a);
    }
    px[i + 3] = Math.round(a / n);
  }
}

// PNG
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log("wrote", OUT, png.length, "bytes");
