"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedStage } from "@/components/AnimatedStage";
import { SkeletonOverlay } from "@/components/SkeletonOverlay";
import { COMMAND_LABELS, COMMAND_ORDER, type CommandId } from "@/lib/commands";
import { applyJointAnimation } from "@/lib/jointAnimation";
import { loadPlayPayload, type PlayPayloadV1 } from "@/lib/sketchPayload";

function runCommandAnimation(
  cmd: CommandId,
  setAnim: (s: { cmd: CommandId; t: number } | null) => void
): Promise<void> {
  const duration =
    cmd === "jump" ? 800 : cmd === "spin" ? 1000 : 1200;
  return new Promise((resolve) => {
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      setAnim({ cmd, t });
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        setAnim(null);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

export default function PlayPage() {
  const [payload, setPayload] = useState<PlayPayloadV1 | null | undefined>(undefined);
  const [queue, setQueue] = useState<CommandId[]>([]);
  const [playing, setPlaying] = useState(false);
  const [animState, setAnimState] = useState<{ cmd: CommandId; t: number } | null>(null);
  const [showDebugSkeleton, setShowDebugSkeleton] = useState(false);
  const playingRef = useRef(false);

  const displayJoints = useMemo(() => {
    if (!payload?.joints) return null;
    if (!animState) return payload.joints;
    return applyJointAnimation(payload.joints, animState.cmd, animState.t);
  }, [payload, animState]);

  const stageTransform = useMemo(() => {
    if (!animState) return { tx: 0, ty: 0, rot: 0 };
    const { cmd, t } = animState;
    if (cmd === "walk") return { tx: Math.sin(t * Math.PI * 2) * 26, ty: 0, rot: 0 };
    if (cmd === "jump") return { tx: 0, ty: -Math.sin(t * Math.PI) * 42, rot: 0 };
    return { tx: 0, ty: 0, rot: t * 360 };
  }, [animState]);

  useEffect(() => {
    setPayload(loadPlayPayload());
  }, []);

  const addBlock = (id: CommandId) => {
    if (playing) return;
    setQueue((q) => [...q, id]);
  };

  const removeAt = (index: number) => {
    if (playing) return;
    setQueue((q) => q.filter((_, i) => i !== index));
  };

  const clearQueue = () => {
    if (playing) return;
    setQueue([]);
  };

  const runSequence = useCallback(async () => {
    if (queue.length === 0 || playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    const copy = [...queue];
    for (const cmd of copy) {
      await runCommandAnimation(cmd, setAnimState);
    }
    setPlaying(false);
    playingRef.current = false;
  }, [queue]);

  if (payload === undefined) {
    return (
      <main className="page">
        <p className="empty">読み込み中…</p>
      </main>
    );
  }

  if (payload === null) {
    return (
      <main className="page">
        <section className="card">
          <h1 className="title">あそび</h1>
          <p className="subtitle">
            データがありません。トップで画像を選び、「線を抜く」または「骨格を読む」のあと「あそびへすすむ」を押してください。
          </p>
          <Link className="linkBtn" href="/">
            トップへもどる
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page page--play">
      <section className="card playCard">
        <div className="playHeader">
          <h1 className="title">あそび</h1>
          <Link className="linkBtnGhost" href="/">
            ← スキャンにもどる
          </Link>
        </div>
        <p className="subtitle">命令を並べて、いっしょに動かそう</p>
        <p className="fileName">ファイル: {payload.fileName}</p>
        <label className="hint" style={{ display: "block", marginTop: 4 }}>
          <input
            type="checkbox"
            checked={showDebugSkeleton}
            onChange={(e) => setShowDebugSkeleton(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          骨格を表示（デバッグ）
        </label>

        <div className="playLayout">
          <div className="playStage">
            <div className="previewWrap previewWrap--fit">
              {displayJoints ? (
                <AnimatedStage
                  tx={stageTransform.tx}
                  ty={stageTransform.ty}
                  rotDeg={stageTransform.rot}
                >
                  <div className="previewInner previewInner--fit">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="previewImg previewImg--fit"
                      src={payload.imageDataUrl}
                      alt="キャラクター画像"
                    />
                    {showDebugSkeleton ? <SkeletonOverlay joints={displayJoints} /> : null}
                  </div>
                </AnimatedStage>
              ) : null}
            </div>
          </div>

          <aside className="playSidebar" aria-label="コマンドブロック">
            <p className="blockSectionTitle">ブロックをタップして追加</p>
            <div className="blockPalette">
              {COMMAND_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="blockChip"
                  onClick={() => addBlock(id)}
                  disabled={playing}
                >
                  {COMMAND_LABELS[id]}
                </button>
              ))}
            </div>

            <p className="blockSectionTitle">ならび（上から順）</p>
            <ol className="blockQueue">
              {queue.length === 0 ? (
                <li className="blockQueueEmpty">まだないよ</li>
              ) : (
                queue.map((id, i) => (
                  <li key={`${id}-${i}`} className="blockQueueItem">
                    <span className="blockQueueLabel">{COMMAND_LABELS[id]}</span>
                    <button
                      type="button"
                      className="blockQueueRemove"
                      onClick={() => removeAt(i)}
                      disabled={playing}
                      aria-label="このブロックを削除"
                    >
                      ×
                    </button>
                  </li>
                ))
              )}
            </ol>

            <div className="blockActions">
              <button
                type="button"
                className="analyzeBtn"
                onClick={runSequence}
                disabled={queue.length === 0 || playing}
              >
                {playing ? "うごいている…" : "これでうごかす"}
              </button>
              <button
                type="button"
                className="secondaryBtn"
                onClick={clearQueue}
                disabled={queue.length === 0 || playing}
              >
                クリア
              </button>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
