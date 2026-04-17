export type JointMap = Record<string, [number, number] | null>;

export function normalizeJoints(raw: unknown): JointMap | null {
  if (!raw || typeof raw !== "object") return null;
  const joints = (raw as { joints?: unknown }).joints;
  if (!joints || typeof joints !== "object") return null;
  const out: JointMap = {};
  for (const [key, val] of Object.entries(joints)) {
    if (val === null) {
      out[key] = null;
      continue;
    }
    if (Array.isArray(val) && val.length === 2) {
      const x = Number(val[0]);
      const y = Number(val[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out[key] = [x, y];
      } else {
        out[key] = null;
      }
    }
  }
  return out;
}
