import { useState } from "react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Bot, Send, Sparkles, Store, ArrowRight } from "lucide-react";

const usd = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;

const QUICK = [
  "오늘 뭐 사?",
  "고마진 상품 뭐 있어?",
  "지금 사면 안 되는 건?",
  "경쟁 적은 블루오션 추천",
  "판매량 급한 인기템은?",
];

interface Pick {
  name: string; brand: string; sold: number; price: number; profit: number | null; reason: string;
}
interface Answer {
  answer: string; picks: Pick[]; source: "ai" | "rule" | "empty";
}

export default function ReverseAssistant() {
  const [q, setQ] = useState("");
  const mut = trpc.reverseDeals.aiAssistant.useMutation();
  const data = mut.data as Answer | undefined;

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    setQ(text);
    mut.mutate({ question: text });
  };

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* 헤더 */}
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Bot className="h-3.5 w-3.5" /> AI Assistant
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">AI 비서</h1>
            <p className="text-slate-300/80 mt-2">
              카탈로그 데이터를 근거로 답합니다 — <b className="text-white">"오늘 뭐 사?"</b>,
              <b className="text-fuchsia-300"> "지금 사면 안 되는 건?"</b> 물어보세요.
            </p>
          </div>

          {/* 입력 */}
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fuchsia-400/70" />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && ask(q)}
                  placeholder="무엇이든 물어보세요 (예: 크록스 지금 사도 돼?)"
                  className="w-full rounded-lg border border-white/15 bg-white/5 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60"
                />
              </div>
              <button
                onClick={() => ask(q)}
                disabled={mut.isPending || !q.trim()}
                className="neon-btn rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> {mut.isPending ? "생각 중…" : "질문"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(qq => (
                <button
                  key={qq}
                  onClick={() => ask(qq)}
                  disabled={mut.isPending}
                  className="text-[12px] rounded-full px-2.5 py-1 bg-white/5 text-slate-300 hover:bg-fuchsia-500/15 hover:text-fuchsia-200 disabled:opacity-50"
                >
                  {qq}
                </button>
              ))}
            </div>
          </div>

          {/* 답변 */}
          {mut.isPending && (
            <div className="glass rounded-2xl p-6 text-center text-slate-400">
              <Bot className="h-6 w-6 mx-auto mb-2 text-fuchsia-300 animate-pulse" />
              카탈로그를 살펴보는 중…
            </div>
          )}
          {mut.isError && (
            <div className="glass rounded-2xl p-4 text-red-300 text-sm">답변 생성 실패: {mut.error.message}</div>
          )}
          {data && !mut.isPending && (
            <div className="space-y-4">
              <div className="glass rounded-2xl p-5 ring-1 ring-fuchsia-400/30">
                <div className="flex items-start gap-2">
                  <Bot className="h-5 w-5 text-fuchsia-300 shrink-0 mt-0.5" />
                  <p className="text-slate-100 leading-relaxed whitespace-pre-line">{data.answer}</p>
                </div>
                {data.source === "rule" && (
                  <p className="text-[10px] text-slate-600 mt-2 ml-7">※ AI 응답 실패 — 판매량 기반 간이 답변</p>
                )}
              </div>

              {data.picks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 tracking-wide">추천 상품</p>
                  {data.picks.map((p, i) => (
                    <div key={i} className="glass rounded-xl p-3 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-100 truncate">{p.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {p.brand || "-"} · 판매 {p.sold.toLocaleString()} · 시세 {usd(p.price)}
                          {p.profit != null && <> · 정산 {usd(p.profit)}</>}
                        </p>
                        {p.reason && <p className="text-[12px] text-fuchsia-300/90 mt-0.5">→ {p.reason}</p>}
                      </div>
                      <Link
                        href={`/reverse/queue?search=${encodeURIComponent(p.brand || p.name)}`}
                        className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold rounded-full px-2.5 py-1 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25"
                        title="소싱 큐에서 국내가 확인"
                      >
                        <Store className="h-3 w-3" /> 소싱 <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!data && !mut.isPending && (
            <p className="text-center text-slate-600 text-sm py-6">
              위 예시 질문을 눌러보거나 직접 물어보세요. 답변은 <b className="text-slate-400">업로드된 카탈로그</b> 기준입니다.
            </p>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
