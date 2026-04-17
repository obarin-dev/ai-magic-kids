import type { JointMap } from "./joints";

export const PLAY_STORAGE_KEY = "sketch-animator-play-payload";

export type PlayPayloadV1 = {
  version: 1;
  savedAt: string;
  fileName: string;
  imageDataUrl: string;
  joints: JointMap;
};

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = dataUrl;
  });
}

/**
 * 線抽出の RGBA（アルファ＝線）を、黒線＋透明背景の PNG にする。
 * あそび画面で画像全体を動かしても「白い板」が一緒に動かないようにする。
 */
export async function lineMaskDataUrlToBlackOnTransparent(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w < 1 || h < 1) throw new Error("画像サイズが不正です");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas が使えません");

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const alphaThreshold = 22;

  for (let i = 0; i < d.length; i += 4) {
    const aIn = d[i + 3] ?? 0;
    if (aIn > alphaThreshold) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 255;
    } else {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

async function resizeToMaxWidthPng(dataUrl: string, maxW: number): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas が使えません");
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

/**
 * アルファ付き PNG を sessionStorage に収めるまで幅だけ縮小（JPEG にしない）。
 */
export async function fitImageDataUrlForSessionStorageWithAlpha(
  dataUrl: string,
  maxChars = 2_000_000
): Promise<string> {
  if (dataUrl.length <= maxChars) return dataUrl;

  let current = dataUrl;
  const widths = [1280, 1024, 896, 768, 640, 512, 384, 320];
  for (const maxW of widths) {
    current = await resizeToMaxWidthPng(current, maxW);
    if (current.length <= maxChars) return current;
  }
  return current;
}

async function compressDataUrl(
  dataUrl: string,
  maxW: number,
  quality: number
): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas が使えません");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * sessionStorage の容量制限を超えにくいように画像 dataURL を圧縮する。
 */
export async function fitImageDataUrlForSessionStorage(
  dataUrl: string,
  maxChars = 2_000_000
): Promise<string> {
  if (dataUrl.length <= maxChars) return dataUrl;

  let current = dataUrl;
  const attempts: Array<[number, number]> = [
    [1280, 0.85],
    [1024, 0.78],
    [896, 0.72],
    [768, 0.68],
    [640, 0.62],
  ];

  for (const [maxW, q] of attempts) {
    current = await compressDataUrl(current, maxW, q);
    if (current.length <= maxChars) return current;
  }
  return current;
}

export function savePlayPayload(input: {
  joints: JointMap;
  imageDataUrl: string;
  fileName: string;
}): void {
  const payload: PlayPayloadV1 = {
    version: 1,
    savedAt: new Date().toISOString(),
    fileName: input.fileName,
    imageDataUrl: input.imageDataUrl,
    joints: input.joints,
  };
  sessionStorage.setItem(PLAY_STORAGE_KEY, JSON.stringify(payload));
}

export function loadPlayPayload(): PlayPayloadV1 | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PLAY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlayPayloadV1>;
    if (parsed.version !== 1 || !parsed.imageDataUrl || !parsed.joints) {
      return null;
    }
    return parsed as PlayPayloadV1;
  } catch {
    return null;
  }
}

export function clearPlayPayload(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PLAY_STORAGE_KEY);
}
