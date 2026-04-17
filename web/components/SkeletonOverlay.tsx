import { SKELETON_LINES } from "@/lib/skeleton";
import type { JointMap } from "@/lib/joints";

type Props = {
  joints: JointMap;
};

export function SkeletonOverlay({ joints }: Props) {
  return (
    <svg className="skeletonOverlay" viewBox="0 0 1 1" preserveAspectRatio="none">
      {SKELETON_LINES.map(([a, b]) => {
        const pa = joints[a];
        const pb = joints[b];
        if (!pa || !pb) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={pa[0]}
            y1={pa[1]}
            x2={pb[0]}
            y2={pb[1]}
            stroke="#5b7cff"
            strokeWidth={0.008}
            strokeLinecap="round"
          />
        );
      })}
      {Object.entries(joints).map(([name, pt]) => {
        if (!pt) return null;
        return (
          <circle
            key={name}
            cx={pt[0]}
            cy={pt[1]}
            r={0.02}
            fill="#ff7eb6"
            stroke="#fff"
            strokeWidth={0.004}
          />
        );
      })}
    </svg>
  );
}
