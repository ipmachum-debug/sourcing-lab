import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Layers, Pin, Sparkles, Clock, AlertCircle, CheckCircle2,
} from "lucide-react";

interface BatchStatusProps {
  data: {
    collectedToday: number;
    totalActive: number;
    neverCollected: number;
    staleKeywords: number;
    lastCollectedAt: string | null;
    batchEngine?: {
      currentGroupTurn: number;
      totalCollectedToday: number;
      roundsToday: number;
      lastBatchCompletedAt: string | null;
      dailyLimit: number;
      maxRoundsPerDay: number;
      batchPerRound: number;
      groupCount: number;
    };
    pinnedCount?: number;
    newKeywordCount?: number;
    overdueCount?: number;
  };
}

export default function BatchStatusCard({ data }: BatchStatusProps) {
  const be = data.batchEngine;
  const collected = be?.totalCollectedToday ?? data.collectedToday;
  const dailyLimit = be?.dailyLimit ?? 500;
  const progress = dailyLimit > 0 ? (collected / dailyLimit) * 100 : 0;
  const roundsToday = be?.roundsToday ?? 0;
  const maxRounds = be?.maxRoundsPerDay ?? 5;
  const currentGroup = be?.currentGroupTurn ?? 0;
  const groupCount = be?.groupCount ?? 5;

  const lastBatch = be?.lastBatchCompletedAt || data.lastCollectedAt;
  const lastBatchStr = lastBatch
    ? new Date(lastBatch).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "-";

  return (
    <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-white">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-bold text-gray-700">수집 엔진 v2</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-slate-300">
              그룹 {currentGroup + 1}/{groupCount}
            </Badge>
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${
              roundsToday >= maxRounds ? "border-red-300 text-red-600" : "border-blue-300 text-blue-600"
            }`}>
              {roundsToday}/{maxRounds}회차
            </Badge>
          </div>
        </div>

        {/* 일일 수집 진행률 */}
        <div className="mb-3">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-gray-500">오늘 수집</span>
            <span className="font-semibold text-gray-700">{collected} / {dailyLimit}</span>
          </div>
          <Progress value={Math.min(progress, 100)} className="h-2" />
          {progress >= 90 && (
            <div className="flex items-center gap-1 mt-1 text-[9px] text-amber-600">
              <AlertCircle className="w-3 h-3" />
              일일 상한에 근접했습니다
            </div>
          )}
        </div>

        {/* 3-티어 상태 */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <TierBadge
            icon={<Pin className="w-3 h-3" />}
            label="핀"
            count={data.pinnedCount ?? 0}
            color="amber"
          />
          <TierBadge
            icon={<Sparkles className="w-3 h-3" />}
            label="신규"
            count={data.newKeywordCount ?? 0}
            color="emerald"
          />
          <TierBadge
            icon={<Clock className="w-3 h-3" />}
            label="대기중"
            count={data.overdueCount ?? 0}
            color="blue"
          />
          <TierBadge
            icon={<CheckCircle2 className="w-3 h-3" />}
            label="전체"
            count={data.totalActive}
            color="slate"
          />
        </div>

        {/* 하단 정보 */}
        <div className="flex items-center justify-between text-[10px] text-gray-400 pt-2 border-t border-gray-100">
          <span>마지막 수집: {lastBatchStr}</span>
          <span>세션 상한: 100개 / 80분</span>
        </div>
      </CardContent>
    </Card>
  );
}

function TierBadge({ icon, label, count, color }: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <div className={`rounded-lg border p-2 text-center ${colorMap[color] || colorMap.slate}`}>
      <div className="flex items-center justify-center gap-0.5 mb-0.5">{icon}</div>
      <div className="text-sm font-bold">{count}</div>
      <div className="text-[9px] opacity-70">{label}</div>
    </div>
  );
}
