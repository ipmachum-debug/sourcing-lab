import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { BookOpen, Search, ChevronDown } from "lucide-react";
import { POIZON_GUIDE, GUIDE_CATS, type GuideSection } from "@/lib/poizonGuide";

// 검색 하이라이트 없이, 쿼리 토큰이 title/keywords/body에 모두(AND) 걸리는 섹션만.
function matches(s: GuideSection, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = (s.title + " " + s.keywords.join(" ") + " " + s.body).toLowerCase();
  return tokens.every(t => hay.includes(t));
}

export default function ReverseGuide() {
  const [term, setTerm] = useState("");
  const [cat, setCat] = useState("전체");
  const [open, setOpen] = useState<string | null>(null);

  const tokens = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(
    () =>
      POIZON_GUIDE.filter(s => (cat === "전체" ? true : s.cat === cat)).filter(s =>
        matches(s, tokens)
      ),
    [tokens, cat]
  );

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <BookOpen className="h-3.5 w-3.5" /> Seller Guide
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">판매자 가이드</h1>
            <p className="text-slate-300/80 mt-2">
              POIZON 한국 입점 판매자센터 매뉴얼을 <b className="text-white">검색</b>으로 바로. 수수료·보관료·배송·정산까지
              — 궁금한 걸 한 단어로 찾으세요. (예: <b className="text-fuchsia-300">수수료</b>, <b className="text-fuchsia-300">보관료</b>, <b className="text-fuchsia-300">자동 조정</b>, <b className="text-fuchsia-300">부가세</b>)
            </p>
          </div>

          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                autoFocus
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="매뉴얼 검색 (수수료, 반품, 정산, 배송, floor…)"
                className="w-full rounded-lg border border-white/15 bg-white/5 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {["전체", ...GUIDE_CATS].map(c => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`rounded-full px-2.5 py-1 text-[12px] transition-all ${
                    cat === c
                      ? "bg-fuchsia-500/25 text-fuchsia-100 ring-1 ring-fuchsia-400/40"
                      : "text-slate-400 hover:text-slate-200 bg-white/5"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[12px] text-slate-500">
            {results.length}개 항목{term && <> · "{term}" 검색</>}
          </p>

          {results.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center text-slate-500">
              일치하는 항목이 없어요. 다른 단어로 검색해 보세요.
            </div>
          ) : (
            <div className="space-y-2">
              {results.map(s => {
                const isOpen = open === s.id || tokens.length > 0;
                return (
                  <div key={s.id} className="glass rounded-2xl overflow-hidden">
                    <button
                      onClick={() => setOpen(open === s.id ? null : s.id)}
                      className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/[0.03]"
                    >
                      <span className="text-[10px] font-semibold text-fuchsia-300/80 bg-fuchsia-500/10 rounded px-1.5 py-0.5 shrink-0">
                        {s.cat}
                      </span>
                      <span className="font-semibold text-slate-100 flex-1">{s.title}</span>
                      {tokens.length === 0 && (
                        <ChevronDown
                          className={`h-4 w-4 text-slate-500 transition-transform ${open === s.id ? "rotate-180" : ""}`}
                        />
                      )}
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1">
                        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-300">
                          {s.body}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-slate-500 pt-2">
            ⓘ 요약본입니다. 정확한 절차·요율은 판매자센터 규정(seller.poizon.com/ruleCenter)을 확인하세요.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
