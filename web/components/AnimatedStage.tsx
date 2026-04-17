"use client";

import type { ReactNode } from "react";

type Props = {
  tx: number;
  ty: number;
  rotDeg: number;
  children: ReactNode;
};

/** 画像＋骨格まとめて動かすラッパー */
export function AnimatedStage({ tx, ty, rotDeg, children }: Props) {
  return (
    <div
      className="animatedStage"
      style={{
        transform: `translate(${tx}px, ${ty}px) rotate(${rotDeg}deg)`,
      }}
    >
      {children}
    </div>
  );
}
