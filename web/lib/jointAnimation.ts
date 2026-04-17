import type { CommandId } from "@/lib/commands";
import type { JointMap } from "@/lib/joints";

function cloneJoints(base: JointMap): JointMap {
  const out: JointMap = {};
  for (const k of Object.keys(base)) {
    const v = base[k];
    out[k] = v ? ([v[0], v[1]] as [number, number]) : null;
  }
  return out;
}

/** 正規化座標の関節に、アニメーション用のオフセットを足したコピーを返す */
export function applyJointAnimation(
  base: JointMap,
  cmd: CommandId,
  t: number
): JointMap {
  const j = cloneJoints(base);

  if (cmd === "walk") {
    const swing = Math.sin(t * Math.PI * 2) * 0.04;
    if (j.hip) j.hip[0] += swing * 0.25;
    if (j.foot_l) {
      j.foot_l[0] += swing;
      j.foot_l[1] += Math.abs(swing) * 0.12;
    }
    if (j.foot_r) {
      j.foot_r[0] -= swing;
      j.foot_r[1] += Math.abs(swing) * 0.12;
    }
    if (j.knee_l) j.knee_l[0] += swing * 0.45;
    if (j.knee_r) j.knee_r[0] -= swing * 0.45;
    if (j.hand_l) j.hand_l[0] += swing * 0.15;
    if (j.hand_r) j.hand_r[0] -= swing * 0.15;
  } else if (cmd === "jump") {
    const ty = -Math.sin(t * Math.PI) * 0.08;
    for (const k of Object.keys(j)) {
      const v = j[k];
      if (v) j[k] = [v[0], v[1] + ty];
    }
  } else if (cmd === "spin") {
    const cx = 0.5;
    const cy = 0.5;
    const rad = t * Math.PI * 2;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const k of Object.keys(j)) {
      const v = j[k];
      if (v) {
        const x = v[0] - cx;
        const y = v[1] - cy;
        j[k] = [cx + x * cos - y * sin, cy + x * sin + y * cos];
      }
    }
  }

  return j;
}
