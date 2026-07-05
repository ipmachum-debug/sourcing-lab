// 의존성 없는 인라인 SVG 스파크라인 + 추세 방향 헬퍼.

interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** 추세 색상 자동 (상승=good 방향). invert=true면 하락이 좋음(가격 등) */
  invert?: boolean;
  color?: string;
  className?: string;
}

export type TrendDir = "up" | "flat" | "down";

/** 앞부분 평균 대비 뒷부분 평균 → 방향 (±3% 안이면 flat) */
export function trendOf(values: number[]): { dir: TrendDir; pct: number } {
  const v = values.filter(n => Number.isFinite(n));
  if (v.length < 2) return { dir: "flat", pct: 0 };
  const half = Math.max(1, Math.floor(v.length / 3));
  const head = v.slice(0, half);
  const tail = v.slice(-half);
  const a = head.reduce((x, y) => x + y, 0) / head.length;
  const b = tail.reduce((x, y) => x + y, 0) / tail.length;
  if (a === 0) return { dir: b > 0 ? "up" : "flat", pct: 0 };
  const pct = Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
  if (pct > 3) return { dir: "up", pct };
  if (pct < -3) return { dir: "down", pct };
  return { dir: "flat", pct };
}

export function TrendArrow({ dir, invert }: { dir: TrendDir; invert?: boolean }) {
  const good =
    dir === "flat" ? "text-slate-400" : (dir === "up") !== !!invert ? "text-emerald-300" : "text-red-300";
  const sym = dir === "up" ? "↗" : dir === "down" ? "↘" : "→";
  return <span className={`font-bold ${good}`}>{sym}</span>;
}

export default function Sparkline({ values, width = 88, height = 26, invert, color, className }: Props) {
  const v = values.filter(n => Number.isFinite(n));
  if (v.length < 2) {
    return (
      <svg width={width} height={height} className={className}>
        <line x1="0" y1={height - 2} x2={width} y2={height - 2} stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
      </svg>
    );
  }
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (v.length - 1);
  const pts = v.map((n, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (n - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const { dir } = trendOf(v);
  const stroke =
    color ?? (dir === "flat" ? "#94a3b8" : (dir === "up") !== !!invert ? "#6ee7b7" : "#fca5a5");
  const last = pts[pts.length - 1];
  const gid = `sg-${Math.round(pts[0][1])}-${v.length}-${Math.round(max)}`;
  return (
    <svg width={width} height={height} className={className} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.1" fill={stroke} />
    </svg>
  );
}
