"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SkeletonOverlay } from "@/components/SkeletonOverlay";
import { normalizeJoints, type JointMap } from "@/lib/joints";
import {
  fileToDataUrl,
  fitImageDataUrlForSessionStorage,
  fitImageDataUrlForSessionStorageWithAlpha,
  lineMaskDataUrlToBlackOnTransparent,
  savePlayPayload,
} from "@/lib/sketchPayload";

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, encoded] = dataUrl.split(",", 2);
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(encoded);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

/** 骨格AIなしで遊ぶとき用（遊び画面は画像全体のトランスフォームが主） */
const EMPTY_JOINTS: JointMap = {};

async function parseApiJsonResponse<T>(res: Response, apiName: string): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  const raw = await res.text();
  const rawOneLine = raw.replace(/\s+/g, " ").slice(0, 180);
  throw new Error(
    `「${apiName}」が JSON 以外を返しました (HTTP ${res.status})。web フォルダで npm run dev を起動し直し、必要なら web/.next を削除してください。応答先頭: ${rawOneLine}`
  );
}

async function parseAnalyzeJson(res: Response): Promise<{
  error?: string;
  data?: unknown;
  rawText?: string;
}> {
  return parseApiJsonResponse(res, "骨格を読む");
}

export default function HomePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joints, setJoints] = useState<JointMap | null>(null);
  const [rawJson, setRawJson] = useState<string | null>(null);
  /** 線抽出のみ（Geminiは呼ばない） */
  const [lineImageDataUrl, setLineImageDataUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);

  const busy = extracting || analyzing || navigating;

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
    };
  }, []);

  const onChangeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    const nextPreviewUrl = selected ? URL.createObjectURL(selected) : null;
    previewObjectUrlRef.current = nextPreviewUrl;
    setFile(selected);
    setPreviewUrl(nextPreviewUrl);
    setError(null);
    setJoints(null);
    setRawJson(null);
    setLineImageDataUrl(null);
    setShowCoordinates(false);
  };

  const onExtractLines = async () => {
    if (!file) return;
    setExtracting(true);
    setError(null);
    setJoints(null);
    setRawJson(null);
    try {
      const extractBody = new FormData();
      extractBody.append("image", file);
      const extractRes = await fetch("/api/extract-lines", {
        method: "POST",
        body: extractBody,
      });
      const extractPayload = await parseApiJsonResponse<{
        error?: string;
        imageDataUrl?: string;
      }>(extractRes, "線を抜く");
      if (!extractRes.ok || !extractPayload.imageDataUrl) {
        setError(extractPayload.error ?? "線抽出に失敗しました");
        return;
      }
      setLineImageDataUrl(extractPayload.imageDataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setExtracting(false);
    }
  };

  const onAnalyzeSkeleton = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    setJoints(null);
    setRawJson(null);
    try {
      const analyzeTarget =
        lineImageDataUrl != null
          ? dataUrlToFile(lineImageDataUrl, "lines-mask.png")
          : file;
      const analyzeBody = new FormData();
      analyzeBody.append("image", analyzeTarget);
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: analyzeBody,
      });
      const payload = await parseAnalyzeJson(res);
      if (!res.ok) {
        setError(payload.error ?? "骨格の読み取りに失敗しました");
        return;
      }
      const parsed = normalizeJoints(payload.data);
      if (!parsed) {
        setError("座標データを解析できませんでした");
        return;
      }
      setJoints(parsed);
      setRawJson(JSON.stringify(payload.data ?? {}, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setAnalyzing(false);
    }
  };

  const canGoPlay =
    !!file && (lineImageDataUrl != null || joints != null);

  const onGoPlay = async () => {
    if (!canGoPlay) return;
    setNavigating(true);
    setError(null);
    try {
      let originalImageDataUrl =
        lineImageDataUrl ?? (await fileToDataUrl(file));
      let imageDataUrl: string;
      if (lineImageDataUrl != null) {
        originalImageDataUrl = await lineMaskDataUrlToBlackOnTransparent(lineImageDataUrl);
        imageDataUrl = await fitImageDataUrlForSessionStorageWithAlpha(originalImageDataUrl);
      } else {
        imageDataUrl = await fitImageDataUrlForSessionStorage(originalImageDataUrl);
      }
      savePlayPayload({
        joints: joints ?? EMPTY_JOINTS,
        imageDataUrl,
        fileName: file.name,
      });
      router.push("/play");
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "画像の保存に失敗しました（画像が大きすぎる可能性があります）";
      setError(msg);
    } finally {
      setNavigating(false);
    }
  };

  const displayPreviewUrl = lineImageDataUrl ?? previewUrl;

  return (
    <main className="page">
      <section className="card">
        <h1 className="title">sketch-animator</h1>
        <p className="subtitle">まずは絵をアップロードしよう</p>

        <div className="uploadBox">
          <label className="uploadLabel" htmlFor="drawing-upload">
            元絵をえらぶ
          </label>
          <input
            id="drawing-upload"
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            onChange={onChangeFile}
            style={{ display: "none" }}
          />
          <p className="hint">対応形式: PNG / JPG / JPEG</p>
          {file && <p className="fileName">選択中: {file.name}</p>}
        </div>

        <div className="actions actionsRow">
          <button
            type="button"
            className="analyzeBtn"
            onClick={onExtractLines}
            disabled={!file || busy}
          >
            {extracting ? "線を抜いています…" : "線を抜く"}
          </button>
          <button
            type="button"
            className="analyzeBtn"
            onClick={onAnalyzeSkeleton}
            disabled={!file || busy}
          >
            {analyzing ? "骨格を読んでいます…" : "骨格を読む（AI）"}
          </button>
          <button
            type="button"
            className="secondaryBtn"
            onClick={onGoPlay}
            disabled={!canGoPlay || busy}
          >
            {navigating ? "いどう中…" : "あそびへすすむ"}
          </button>
        </div>

        <p className="hint" style={{ marginTop: 8 }}>
          「線を抜く」までできれば、骨格AIなしでもあそびへ進めます（絵全体がうごきます）。
        </p>

        {joints && (
          <label className="hint" style={{ display: "block", marginTop: 6 }}>
            <input
              type="checkbox"
              checked={showCoordinates}
              onChange={(e) => setShowCoordinates(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            座標オーバーレイを表示（デバッグ）
          </label>
        )}

        {error && <p className="errorMsg">{error}</p>}

        <div className="previewWrap previewWrap--fit">
          {displayPreviewUrl ? (
            <div className="previewInner previewInner--fit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="previewImg previewImg--fit" src={displayPreviewUrl} alt="アップロード画像プレビュー" />
              {joints && showCoordinates && <SkeletonOverlay joints={joints} />}
            </div>
          ) : (
            <p className="empty">ここにプレビューが表示されます</p>
          )}
        </div>

        {rawJson && showCoordinates && (
          <details className="jsonDetails">
            <summary>JSON（生データ）</summary>
            <pre className="jsonPre">{rawJson}</pre>
          </details>
        )}
      </section>
    </main>
  );
}
