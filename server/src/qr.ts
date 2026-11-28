// Minimal QR code generator (byte mode, EC level M, versions 1–6) used to
// render UPI payment QR codes server-side. Implements the standard QR
// model-2 encoding: Reed–Solomon over GF(256), block interleaving, mask
// selection by penalty score, and BCH format information. Output is an
// SVG string the client can drop into an <img> or inline element.
//
// Capacity at level M: V1=14, V2=26, V3=42, V4=62, V5=84, V6=106 bytes —
// a UPI intent URL for this store is ~90 bytes, so V6 is enough. Longer
// input throws; the caller falls back to showing the UPI id/link.

// ---- GF(256) tables -------------------------------------------------------
const EXP = new Array<number>(256);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 256; i++) EXP[i] = EXP[i - 255] ?? 0;
}
function glog(n: number): number {
  if (n < 1) throw new Error("glog");
  return LOG[n] ?? 0;
}
function gexp(n: number): number {
  let v = n;
  while (v < 0) v += 255;
  while (v >= 256) v -= 255;
  return EXP[v] ?? 0;
}

// ---- Reed–Solomon ---------------------------------------------------------
function rsGeneratorPoly(deg: number): number[] {
  let poly: number[] = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      const c = poly[j] ?? 0;
      next[j] = (next[j] ?? 0) ^ gexp(glog(c) + i);
      next[j + 1] = (next[j + 1] ?? 0) ^ c;
    }
    poly = next;
  }
  return poly;
}
function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ (res.shift() ?? 0);
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) {
        // gen[] is ascending (gen[k] = coefficient of x^k, gen[ecLen] = 1).
        // The LFSR pairs res[i] with the divisor coefficient of
        // x^(ecLen-1-i) — i.e. gen[ecLen-1-i], NOT gen[i+1].
        res[i] = (res[i] ?? 0) ^ gexp(glog(gen[ecLen - 1 - i] ?? 0) + glog(factor));
      }
    }
  }
  return res;
}

// ---- Version table (EC level M): [blockCount, totalPerBlock, dataPerBlock]
const RS_BLOCKS: Record<number, [number, number, number]> = {
  1: [1, 26, 16],
  2: [1, 44, 28],
  3: [1, 70, 44],
  4: [2, 50, 32],
  5: [2, 67, 43],
  6: [4, 43, 27],
};
const ALIGN: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

function buildDataCodewords(bytes: number[], version: number): number[] {
  const spec = RS_BLOCKS[version];
  if (!spec) throw new Error("bad version");
  const totalData = spec[0] * spec[2];
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const cap = totalData * 8;
  const term = Math.min(4, cap - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] ?? 0);
    out.push(v);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (out.length < totalData) {
    out.push(pads[p % 2] ?? 0xec);
    p++;
  }
  return out;
}

function interleave(data: number[], version: number): number[] {
  const spec = RS_BLOCKS[version];
  if (!spec) throw new Error("bad version");
  const [count, total, dataLen] = spec;
  const ecLen = total - dataLen;
  const blocks: { data: number[]; ec: number[] }[] = [];
  for (let i = 0; i < count; i++) {
    const d = data.slice(i * dataLen, (i + 1) * dataLen);
    blocks.push({ data: d, ec: rsEncode(d, ecLen) });
  }
  const out: number[] = [];
  for (let i = 0; i < dataLen; i++)
    for (const b of blocks) if (b.data[i] !== undefined) out.push(b.data[i] as number);
  for (let i = 0; i < ecLen; i++)
    for (const b of blocks) if (b.ec[i] !== undefined) out.push(b.ec[i] as number);
  return out;
}

// ---- Matrix ---------------------------------------------------------------
type Matrix = (boolean | null)[][];

function baseMatrix(version: number): { mod: Matrix; size: number } {
  const size = version * 4 + 17;
  const mod: Matrix = Array.from({ length: size }, () =>
    new Array<boolean | null>(size).fill(null),
  );
  const finder = (x: number, y: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
        const edge =
          (dx === 0 || dx === 6 || dy === 0 || dy === 6) &&
          dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        mod[yy]![xx] = edge || core;
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  // timing
  for (let i = 8; i < size - 8; i++) {
    mod[6]![i] = i % 2 === 0;
    mod[i]![6] = i % 2 === 0;
  }
  // alignment patterns
  const pos = ALIGN[version] ?? [];
  for (const cy of pos) {
    for (const cx of pos) {
      if (mod[cy]![cx] !== null) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          mod[cy + dy]![cx + dx] =
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1 || (dx === 0 && dy === 0);
        }
      }
    }
  }
  // reserve format info areas + dark module (exactly the cells the
  // format writer below touches — reserving any extra cell would steal
  // a data module and corrupt the symbol)
  for (let i = 0; i < 9; i++) {
    if (mod[8]![i] === null) mod[8]![i] = false;
    if (mod[i]![8] === null) mod[i]![8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (mod[8]![size - 1 - i] === null) mod[8]![size - 1 - i] = false;
  }
  for (let i = 0; i < 6; i++) {
    if (mod[size - 1 - i]![8] === null) mod[size - 1 - i]![8] = false;
  }
  mod[size - 8]![8] = true; // dark module
  return { mod, size };
}

function placeData(mod: Matrix, size: number, bits: number[], mask: number) {
  const maskFn = (r: number, c: number): boolean => {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };
  let bitIdx = 0;
  let dir = -1;
  let row = size - 1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (let c = 0; c < 2; c++) {
        const xx = col - c;
        if (mod[row]![xx] === null) {
          let dark = false;
          if (bitIdx < bits.length) dark = bits[bitIdx] === 1;
          if (maskFn(row, xx)) dark = !dark;
          mod[row]![xx] = dark;
          bitIdx++;
        }
      }
      row += dir;
      if (row < 0 || row >= size) {
        row -= dir;
        dir = -dir;
        break;
      }
    }
  }
}

function formatBits(mask: number): number {
  // EC level M indicator bits = 00
  const data = mask; // (00 << 3) | mask
  let v = data << 10;
  const g = 0x537;
  const bitLen = (n: number) => 32 - Math.clz32(n);
  while (bitLen(v) >= 11) {
    v ^= g << (bitLen(v) - 11);
  }
  return (((data << 10) | v) ^ 0x5412) & 0x7fff;
}

function placeFormat(mod: Matrix, size: number, mask: number) {
  const bits = formatBits(mask);
  const get = (i: number) => ((bits >>> i) & 1) === 1;
  // Standard placement (same mapping as the reference qrcode-generator):
  // bit i is the i-th least significant bit of the 15-bit format value.
  for (let i = 0; i < 15; i++) {
    const m = get(i);
    // vertical copy (column 8)
    if (i < 8) mod[i]![8] = m;
    else if (i === 8) mod[9]![8] = m;
    else mod[size - 15 + i]![8] = m;
    // horizontal copy (row 8)
    if (i < 8) mod[8]![size - 1 - i] = m;
    else if (i === 8) mod[8]![7] = m;
    else mod[8]![15 - i - 1] = m;
  }
  mod[size - 8]![8] = true; // dark module
}

function penalty(mod: Matrix, size: number): number {
  let score = 0;
  const at = (r: number, c: number) => mod[r]![c] === true;
  // rule 1: runs
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (at(r, c) === at(r, c - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (at(r, c) === at(r - 1, c)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  // rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++)
    for (let c = 0; c < size - 1; c++)
      if (at(r, c) === at(r, c + 1) && at(r, c) === at(r + 1, c) && at(r, c) === at(r + 1, c + 1))
        score += 3;
  // rule 3: finder-like patterns
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matchAt = (line: boolean[], off: number, pat: number[]) =>
    pat.every((p, i) => (line[off + i] ? 1 : 0) === p);
  for (let r = 0; r < size; r++) {
    const rowLine: boolean[] = [];
    const colLine: boolean[] = [];
    for (let c = 0; c < size; c++) {
      rowLine.push(at(r, c));
      colLine.push(at(c, r));
    }
    for (let i = 0; i + 11 <= size; i++) {
      if (matchAt(rowLine, i, pat1) || matchAt(rowLine, i, pat2)) score += 40;
      if (matchAt(colLine, i, pat1) || matchAt(colLine, i, pat2)) score += 40;
    }
  }
  // rule 4: dark ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (at(r, c)) dark++;
  const total = size * size;
  score += Math.floor(Math.abs((dark * 100) / total - 50) / 5) * 10;
  return score;
}

export function qrSvg(text: string, modulePx = 6): string {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 0;
  for (let v = 1; v <= 6; v++) {
    const spec = RS_BLOCKS[v];
    if (!spec) continue;
    if (4 + 8 + bytes.length * 8 <= spec[0] * spec[2] * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new Error("qr: input too long");
  const data = buildDataCodewords(bytes, version);
  const codewords = interleave(data, version);
  const bits: number[] = [];
  for (const cw of codewords)
    for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);

  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const { mod, size } = baseMatrix(version);
    placeData(mod, size, bits, mask);
    placeFormat(mod, size, mask);
    const s = penalty(mod, size);
    if (s < bestScore) {
      bestScore = s;
      best = mod;
    }
  }
  if (!best) throw new Error("qr: failed");
  const size = best.length;
  const quiet = 4;
  const dim = (size + quiet * 2) * modulePx;
  let d = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (best[r]![c]) {
        d += `M${(c + quiet) * modulePx} ${(r + quiet) * modulePx}h${modulePx}v${modulePx}h-${modulePx}z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}"><rect width="${dim}" height="${dim}" fill="#ffffff"/><path d="${d}" fill="#2B2118"/></svg>`;
}
