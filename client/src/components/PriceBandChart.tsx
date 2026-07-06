// 시세 추이 + P25/P50/P75 안정가 밴드 인라인 SVG 차트 (의존성 없음).

interface Pt { t: number; price: number }
interface Band { p25: number; p50: number; p75: number; min: number; max: number }

interface Props {
  points: Pt[];
  band: Band;
  width?: number;
  height?: number;
}

const won = (n: number) => Math.round(n).toLocaleString();

export default function PriceBandChart({ points, band, width = 640, height = 240 }: Props) {
  const pts = points.filter(p => p.price > 0).sort((a, b) => a.t - b.t);
  const padL = 46, padR = 12, padT = 14, padB = 22;
  const iw = width - padL - padR;
  const ih = height - padT - padB;

  if (pts.length < 2) {
    return (
      <div className="grid place-items-center text-sm text-slate-500" style={{ height }}>
        시세 표본이 2개 이상 쌓이면 그래프가 그려집니다
      </div>
    );
  }

  const prices = pts.map(p => p.price);
  const lo = Math.min(band.min || Infinity, ...prices);
  const hi = Math.max(band.max || 0, ...prices);
  const span = hi - lo || 1;
  const yPad = span * 0.12;
  const yMin = lo - yPad, yMax = hi + yPad;
  const tMin = pts[0].t, tMax = pts[pts.length - 1].t;
  const tSpan = tMax - tMin || 1;

  const X = (t: number) => padL + ((t - tMin) / tSpan) * iw;
  const Y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.t).toFixed(1)},${Y(p.price).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];

  // y 그리드 (P25/P50/P75 + min/max 근처)
  const yTicks = [yMax, band.p75, band.p50, band.p25, yMin].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  const fmtDate = (t: number) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%" }}>
      {/* 안정가 밴드 P25~P75 */}
      <rect x={padL} y={Y(band.p75)} width={iw} height={Math.max(0, Y(band.p25) - Y(band.p75))}
        fill="rgba(217,70,239,0.10)" />
      {/* P50 (중앙값) 점선 */}
      <line x1={padL} y1={Y(band.p50)} x2={padL + iw} y2={Y(band.p50)} stroke="rgba(232,121,249,0.5)" strokeWidth="1" strokeDasharray="4 3" />
      {/* P25 안정가 실선 (매입 기준선) */}
      <line x1={padL} y1={Y(band.p25)} x2={padL + iw} y2={Y(band.p25)} stroke="rgba(110,231,183,0.55)" strokeWidth="1" strokeDasharray="2 2" />

      {/* y 라벨 */}
      {yTicks.map((v, i) => (
        <text key={i} x={padL - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">{won(v)}원</text>
      ))}
      {/* 밴드 라벨 */}
      <text x={padL + iw} y={Y(band.p25) - 3} textAnchor="end" fontSize="9" fill="#6ee7b7">P25 안정가</text>
      <text x={padL + iw} y={Y(band.p50) - 3} textAnchor="end" fontSize="9" fill="#e879f9">P50</text>

      {/* 시세 라인 */}
      <path d={line} fill="none" stroke="#e879f9" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* 데이터 포인트 */}
      {pts.map((p, i) => <circle key={i} cx={X(p.t)} cy={Y(p.price)} r="1.8" fill="#e879f9" fillOpacity="0.5" />)}
      {/* 현재 시세 강조 */}
      <circle cx={X(last.t)} cy={Y(last.price)} r="3.5" fill="#e879f9" />
      <text x={X(last.t) - 6} y={Y(last.price) - 6} textAnchor="end" fontSize="10" fill="#f5d0fe" fontWeight="bold">{won(last.price)}원</text>

      {/* x 라벨 (양끝 + 중앙) */}
      <text x={padL} y={height - 6} fontSize="10" fill="#64748b">{fmtDate(tMin)}</text>
      <text x={padL + iw / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="#64748b">{fmtDate(tMin + tSpan / 2)}</text>
      <text x={padL + iw} y={height - 6} textAnchor="end" fontSize="10" fill="#64748b">{fmtDate(tMax)}</text>
    </svg>
  );
}
