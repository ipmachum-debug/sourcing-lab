import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Plug, CheckCircle2, XCircle, MinusCircle, ExternalLink, PlayCircle, KeyRound } from "lucide-react";

interface SelfTestResult { key: string; interfaceName: string; ok: boolean; skipped: boolean; message: string }

export default function ReverseApi() {
  const status = trpc.reverseDeals.openApiStatus.useQuery();
  const test = trpc.reverseDeals.poizonSelfTest.useMutation();
  const s = status.data as any;
  const r = s?.readiness;
  const results = (test.data?.results ?? []) as SelfTestResult[];

  const Step = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={`inline-flex items-center gap-1.5 text-sm ${ok ? "text-emerald-300" : "text-slate-500"}`}>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <MinusCircle className="h-4 w-4" />}
      {label}
    </span>
  );

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* 헤더 */}
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Plug className="h-3.5 w-3.5" /> POIZON API
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">POIZON 연동</h1>
            <p className="text-slate-300/80 mt-2">인증 → 자가진단 → 자동입찰. 승인 후 여기서 실제 연결을 켭니다.</p>
          </div>

          {/* 준비 상태 */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="h-4 w-4 text-fuchsia-300" />
              <h2 className="text-sm font-semibold text-slate-100">자격증명 상태</h2>
              {r?.ready ? (
                <span className="ml-auto text-[11px] font-semibold text-emerald-300">가동 준비 완료</span>
              ) : (
                <span className="ml-auto text-[11px] font-semibold text-amber-300">연결 필요</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Step ok={!!r?.appKey} label="App Key" />
              <Step ok={!!r?.appSecret} label="App Secret" />
              <Step ok={!!(r?.accessToken || r?.hasStoredToken)} label="Access Token" />
              <Step ok={!!r?.ready} label="가동 준비" />
            </div>
            {s?.storedToken?.hasToken && (
              <p className="text-[11px] text-slate-500 mt-3">
                저장된 토큰 {s.storedToken.openId ? `(openId ${s.storedToken.openId})` : ""}
                {s.storedToken.accessExpired ? " · ⚠️ 만료됨 — 재인증 필요" : s.storedToken.accessExpiresAt ? ` · 만료 ${String(s.storedToken.accessExpiresAt).slice(0, 10)}` : ""}
              </p>
            )}
            {s?.note && <p className="text-[12px] text-slate-400 mt-2">{s.note}</p>}
          </div>

          {/* 1단계: 인증 */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-6 w-6 rounded-full grid place-items-center text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#db2777,#a855f7)" }}>1</span>
              <h2 className="text-sm font-semibold text-slate-100">판매자 인증 (Access Token 발급)</h2>
            </div>
            <p className="text-[12px] text-slate-400 mb-3">
              아래 버튼 → POIZON 로그인·동의 → 토큰이 서버에 자동 저장됩니다. (App Secret이 .env에 반영돼 있어야 함)
            </p>
            <a
              href="/api/poizon/authorize"
              className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <ExternalLink className="h-4 w-4" /> POIZON 인증하기
            </a>
          </div>

          {/* 2단계: 자가진단 */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-6 w-6 rounded-full grid place-items-center text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#db2777,#a855f7)" }}>2</span>
              <h2 className="text-sm font-semibold text-slate-100">자가진단 (인터페이스 연결 확인)</h2>
            </div>
            <p className="text-[12px] text-slate-400 mb-3">
              읽기형 인터페이스를 실제 호출해 연결·서명·권한을 검증합니다. 쓰기형(입찰)은 안전상 자동 실행하지 않습니다.
            </p>
            <button
              onClick={() => test.mutate({})}
              disabled={test.isPending}
              className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <PlayCircle className={`h-4 w-4 ${test.isPending ? "animate-pulse" : ""}`} />
              {test.isPending ? "진단 중…" : "자가진단 실행"}
            </button>

            {results.length > 0 && (
              <ul className="mt-4 space-y-2">
                {results.map(x => (
                  <li key={x.key} className="flex items-start gap-2 rounded-lg bg-white/5 px-3 py-2">
                    {x.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0 mt-0.5" />
                    ) : x.skipped ? (
                      <MinusCircle className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-100">{x.interfaceName}</p>
                      <p className={`text-[11px] ${x.ok ? "text-emerald-300/80" : x.skipped ? "text-slate-500" : "text-red-300"}`}>{x.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {test.isError && <p className="text-red-300 text-sm mt-3">{test.error.message}</p>}
          </div>

          <p className="text-[11px] text-slate-600 text-center">
            자가진단이 통과하면 자동입찰(자동추종) 실행부를 연결합니다.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
