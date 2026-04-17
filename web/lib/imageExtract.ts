import type { JointMap } from "@/lib/joints";
import { SKELETON_LINES } from "@/lib/skeleton";

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}

export type NormalizedBBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};
export type NormalizedPoint = [number, number];
export type NormalizedPolygon = NormalizedPoint[];
export type ExtractOptions = {
  bbox?: NormalizedBBox | null;
  polygon?: NormalizedPolygon | null;
  joints?: JointMap | null;
  strictMask?: boolean;
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function normalizeCrop(
  width: number,
  height: number,
  bbox?: NormalizedBBox | null
): { sx: number; sy: number; sw: number; sh: number } {
  if (!bbox) return { sx: 0, sy: 0, sw: width, sh: height };
  const x = clamp01(bbox.x);
  const y = clamp01(bbox.y);
  const w = clamp01(bbox.w);
  const h = clamp01(bbox.h);
  if (w <= 0 || h <= 0) return { sx: 0, sy: 0, sw: width, sh: height };

  const padRatio = 0.18;
  const px = w * padRatio;
  const py = h * padRatio;
  const x0 = clamp01(x - px);
  const y0 = clamp01(y - py);
  const x1 = clamp01(x + w + px);
  const y1 = clamp01(y + h + py);

  const sx = Math.max(0, Math.floor(x0 * width));
  const sy = Math.max(0, Math.floor(y0 * height));
  const ex = Math.min(width, Math.ceil(x1 * width));
  const ey = Math.min(height, Math.ceil(y1 * height));
  const sw = Math.max(1, ex - sx);
  const sh = Math.max(1, ey - sy);
  return { sx, sy, sw, sh };
}

function polygonBounds(poly: NormalizedPolygon): NormalizedBBox | null {
  if (!poly || poly.length < 3) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of poly) {
    minX = Math.min(minX, clamp01(x));
    minY = Math.min(minY, clamp01(y));
    maxX = Math.max(maxX, clamp01(x));
    maxY = Math.max(maxY, clamp01(y));
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-8) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-8) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function buildJointBandMask(
  width: number,
  height: number,
  image: { naturalWidth: number; naturalHeight: number },
  crop: { sx: number; sy: number },
  joints: JointMap
): Uint8Array {
  const out = new Uint8Array(width * height);
  const bones: [number, number, number, number][] = [];
  for (const [aName, bName] of SKELETON_LINES) {
    const a = joints[aName];
    const b = joints[bName];
    if (!a || !b) continue;
    const ax = a[0] * image.naturalWidth - crop.sx;
    const ay = a[1] * image.naturalHeight - crop.sy;
    const bx = b[0] * image.naturalWidth - crop.sx;
    const by = b[1] * image.naturalHeight - crop.sy;
    bones.push([ax, ay, bx, by]);
  }
  if (bones.length === 0) return out;

  const band = Math.max(10, Math.round(Math.min(width, height) * 0.08));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      for (const [ax, ay, bx, by] of bones) {
        if (distancePointToSegment(x, y, ax, ay, bx, by) <= band) {
          out[idx] = 1;
          break;
        }
      }
    }
  }
  return out;
}

function estimatePaperLuma(data: Uint8ClampedArray, width: number, height: number): number {
  const samples: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  for (let x = 0; x < width; x += step) {
    const top = (0 * width + x) * 4;
    const bottom = ((height - 1) * width + x) * 4;
    samples.push(0.2126 * data[top] + 0.7152 * data[top + 1] + 0.0722 * data[top + 2]);
    samples.push(
      0.2126 * data[bottom] + 0.7152 * data[bottom + 1] + 0.0722 * data[bottom + 2]
    );
  }
  for (let y = 0; y < height; y += step) {
    const left = (y * width + 0) * 4;
    const right = (y * width + (width - 1)) * 4;
    samples.push(0.2126 * data[left] + 0.7152 * data[left + 1] + 0.0722 * data[left + 2]);
    samples.push(
      0.2126 * data[right] + 0.7152 * data[right + 1] + 0.0722 * data[right + 2]
    );
  }
  if (samples.length === 0) return 245;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.75)] ?? 245;
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask[ny * width + nx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 1;
      for (let dy = -radius; dy <= radius && on; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (!mask[ny * width + nx]) {
            on = 0;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function keepImportantComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  jointBand?: Uint8Array | null
): Uint8Array {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const out = new Uint8Array(mask.length);
  const minSize = Math.max(120, Math.floor(width * height * 0.0012));
  const importantPixelMin = Math.max(24, Math.floor(width * height * 0.00015));

  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 0 || visited[i] === 1) continue;
    visited[i] = 1;
    let size = 0;
    let importantHits = 0;
    let qh = 0;
    let qt = 0;
    queue[qt++] = i;
    const pixels: number[] = [];

    while (qh < qt) {
      const idx = queue[qh++];
      size += 1;
      pixels.push(idx);
      if (jointBand?.[idx]) importantHits += 1;
      const x = idx % width;
      const y = Math.floor(idx / width);

      const neighbors = [
        idx - 1,
        idx + 1,
        idx - width,
        idx + width,
      ];
      for (const nIdx of neighbors) {
        if (nIdx < 0 || nIdx >= mask.length) continue;
        const nx = nIdx % width;
        const ny = Math.floor(nIdx / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        if (mask[nIdx] === 0 || visited[nIdx] === 1) continue;
        visited[nIdx] = 1;
        queue[qt++] = nIdx;
      }
    }

    if (size >= minSize || importantHits >= importantPixelMin) {
      for (const p of pixels) out[p] = 1;
    }
  }
  return out;
}

/**
 * 白背景に近いピクセルを透明化し、描画部分を抽出した data URL を返す。
 * bbox を受けた場合は主役領域を先に切り出してから処理する。
 */
export async function extractDrawingDataUrl(file: File, opts: ExtractOptions = {}): Promise<string> {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas が使えません");

  const polyBBox = opts.polygon ? polygonBounds(opts.polygon) : null;
  const selectedBBox =
    opts.bbox && polyBBox
      ? {
          x: Math.min(opts.bbox.x, polyBBox.x),
          y: Math.min(opts.bbox.y, polyBBox.y),
          w:
            Math.max(opts.bbox.x + opts.bbox.w, polyBBox.x + polyBBox.w) -
            Math.min(opts.bbox.x, polyBBox.x),
          h:
            Math.max(opts.bbox.y + opts.bbox.h, polyBBox.y + polyBBox.h) -
            Math.min(opts.bbox.y, polyBBox.y),
        }
      : (opts.bbox ?? polyBBox);
  const crop = normalizeCrop(img.naturalWidth, img.naturalHeight, selectedBBox);
  canvas.width = crop.sw;
  canvas.height = crop.sh;
  ctx.drawImage(
    img,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    crop.sw,
    crop.sh
  );

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const width = canvas.width;
  const height = canvas.height;
  const mask = new Uint8Array(width * height);
  let cropPolygon: [number, number][] | null = null;
  if (opts.polygon && opts.polygon.length >= 3) {
    cropPolygon = opts.polygon.map(([nx, ny]) => {
      const px = clamp01(nx) * img.naturalWidth - crop.sx;
      const py = clamp01(ny) * img.naturalHeight - crop.sy;
      return [px, py];
    });
  }

  const jointBand = opts.joints
    ? buildJointBandMask(
        width,
        height,
        { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight },
        { sx: crop.sx, sy: crop.sy },
        opts.joints
      )
    : null;
  const paperLuma = estimatePaperLuma(data, width, height);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 0) continue;

    // 白紙背景とノートの薄線を落とし、濃い線や色を残す
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max - min;
    const strict = opts.strictMask ?? true;
    const darknessFromPaper = paperLuma - lum;
    let isForeground = strict
      ? darknessFromPaper > 22 || saturation > 28
      : darknessFromPaper > 14 || saturation > 18;
    if (isForeground && cropPolygon) {
      const px = (i / 4) % width;
      const py = Math.floor(i / 4 / width);
      // AI 輪郭があれば、輪郭外は落として「キャラ本体だけ」に寄せる
      if (!pointInPolygon(px, py, cropPolygon)) {
        isForeground = false;
      }
    }
    if (isForeground && strict && jointBand) {
      // 骨格近傍だけを残しやすくして、ノート線の混入を抑える
      if (jointBand[i / 4] === 0) isForeground = false;
    }
    mask[i / 4] = isForeground ? 1 : 0;
  }

  // Step 2: 線切れを補正するため closing (dilate -> erode)
  const radius = Math.max(1, Math.round(Math.min(width, height) * 0.004));
  const closed = erode(dilate(mask, width, height, radius), width, height, radius);
  // Step 3: 重要な連結成分を複数保持（最大1成分固定をやめる）
  const kept = keepImportantComponents(closed, width, height, jointBand);

  for (let i = 0; i < data.length; i += 4) {
    if (kept[i / 4] === 0) {
      data[i + 3] = 0;
    } else {
      // 連結成分を残すピクセルは少しだけ濃くして視認性を上げる
      data[i] = Math.max(0, data[i] - 6);
      data[i + 1] = Math.max(0, data[i + 1] - 6);
      data[i + 2] = Math.max(0, data[i + 2] - 6);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
