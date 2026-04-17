"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { JointMap } from "@/lib/joints";
import { SKELETON_LINES } from "@/lib/skeleton";

type Props = {
  imageDataUrl: string;
  joints: JointMap;
  showSkeleton?: boolean;
  className?: string;
};

/** 背後から前へ（脚→腕→首→頭） */
const SEGMENT_DRAW_ORDER: [string, string][] = [
  ["hip", "knee_r"],
  ["knee_r", "foot_r"],
  ["hip", "knee_l"],
  ["knee_l", "foot_l"],
  ["shoulder", "hip"],
  ["shoulder", "elbow_r"],
  ["elbow_r", "hand_r"],
  ["shoulder", "elbow_l"],
  ["elbow_l", "hand_l"],
  ["head", "shoulder"],
];

function drawSegmentAlongBone(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  joints: JointMap,
  na: string,
  nb: string,
  thicknessFrac: number,
  padFrac: number
) {
  const a = joints[na];
  const b = joints[nb];
  if (!a || !b) return;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const ax = a[0] * w;
  const ay = a[1] * h;
  const bx = b[0] * w;
  const by = b[1] * h;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;

  const angle = Math.atan2(dy, dx);
  const th = Math.min(w, h) * thicknessFrac;
  const pad = Math.min(w, h) * padFrac;

  const minX = Math.max(0, Math.min(ax, bx) - pad);
  const minY = Math.max(0, Math.min(ay, by) - pad);
  const maxX = Math.min(w, Math.max(ax, bx) + pad);
  const maxY = Math.min(h, Math.max(ay, by) + pad);
  const sw = maxX - minX;
  const sh = maxY - minY;
  if (sw < 1 || sh < 1) return;

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(angle);
  ctx.drawImage(img, minX, minY, sw, sh, 0, -sh / 2, len, sh);
  ctx.restore();
}

function drawHeadPatch(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  joints: JointMap
) {
  const head = joints.head;
  const shoulder = joints.shoulder;
  if (!head || !shoulder) return;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const hx = head[0] * w;
  const hy = head[1] * h;
  const sx = shoulder[0] * w;
  const sy = shoulder[1] * h;
  const r = Math.max(8, Math.hypot(hx - sx, hy - sy) * 0.95);

  ctx.save();
  ctx.beginPath();
  ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, img: HTMLImageElement, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawSkeletonLines(
  ctx: CanvasRenderingContext2D,
  joints: JointMap,
  w: number,
  h: number
) {
  ctx.save();
  ctx.strokeStyle = "rgba(91, 124, 255, 0.85)";
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012);
  ctx.lineCap = "round";
  for (const [na, nb] of SKELETON_LINES) {
    const a = joints[na];
    const b = joints[nb];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a[0] * w, a[1] * h);
    ctx.lineTo(b[0] * w, b[1] * h);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255, 126, 182, 0.95)";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.004);
  for (const [, pt] of Object.entries(joints)) {
    if (!pt) continue;
    const x = pt[0] * w;
    const y = pt[1] * h;
    const rad = Math.max(3, Math.min(w, h) * 0.018);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function SkinnedDrawingCanvas({
  imageDataUrl,
  joints,
  showSkeleton = true,
  className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const paintRef = useRef<() => void>(() => {});

  const paint = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!wrap || !canvas || !img?.complete || img.naturalWidth === 0) return;

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const maxW = wrap.clientWidth;
    const maxH = wrap.clientHeight;
    if (maxW < 1 || maxH < 1) return;

    const scale = Math.min(maxW / iw, maxH / ih, 1);
    const cssW = Math.round(iw * scale);
    const cssH = Math.round(ih * scale);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.scale(scale, scale);

    drawGhost(ctx, img, 0.32);

    const thick = 0.085;
    const pad = 0.02;
    for (const [na, nb] of SEGMENT_DRAW_ORDER) {
      drawSegmentAlongBone(ctx, img, joints, na, nb, thick, pad);
    }

    drawHeadPatch(ctx, img, joints);

    if (showSkeleton) {
      drawSkeletonLines(ctx, joints, iw, ih);
    }

    ctx.restore();
  }, [joints, showSkeleton]);

  paintRef.current = paint;

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      paintRef.current();
    };
    img.src = imageDataUrl;
    return () => {
      imgRef.current = null;
    };
  }, [imageDataUrl]);

  useLayoutEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => paintRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className={className ?? "skinnedDrawingWrap"}>
      <canvas ref={canvasRef} className="skinnedDrawingCanvas" />
    </div>
  );
}
