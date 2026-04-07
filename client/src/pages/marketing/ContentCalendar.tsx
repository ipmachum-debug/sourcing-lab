import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  post: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  story: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  reel: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  shorts: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  live: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  blog: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  meeting: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  deadline: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  promotion: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  memo: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
  holiday: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
};

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

export default function ContentCalendar() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newType, setNewType] = useState("post");

  const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${new Date(year, month + 1, 0).getDate()}`;

  const utils = trpc.useUtils();
  const events = trpc.marketing.calendar.getEvents.useQuery({ startDate, endDate });
  const createEvent = trpc.marketing.calendar.create.useMutation({
    onSuccess: () => {
      toast.success("일정이 추가되었습니다.");
      setShowAdd(false);
      setNewTitle("");
      utils.marketing.calendar.getEvents.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteEvent = trpc.marketing.calendar.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.calendar.getEvents.invalidate();
    },
  });

  const days = useMemo(() => getMonthDays(year, month), [year, month]);
  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const ev of events.data || []) {
      const day = ev.eventDate.slice(8, 10).replace(/^0/, "");
      if (!map[day]) map[day] = [];
      map[day].push(ev);
    }
    return map;
  }, [events.data]);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDay = new Date().getDate();
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <h1 className="text-xl font-bold">{year}년 {month + 1}월</h1>
            <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />일정 추가</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>일정 추가</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="일정 제목" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
                <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
                <Input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} />
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="post">포스트</SelectItem>
                    <SelectItem value="story">스토리</SelectItem>
                    <SelectItem value="reel">릴스</SelectItem>
                    <SelectItem value="shorts">쇼츠</SelectItem>
                    <SelectItem value="live">라이브</SelectItem>
                    <SelectItem value="blog">블로그</SelectItem>
                    <SelectItem value="meeting">미팅</SelectItem>
                    <SelectItem value="deadline">마감</SelectItem>
                    <SelectItem value="promotion">프로모션</SelectItem>
                    <SelectItem value="memo">메모</SelectItem>
                  </SelectContent>
                </Select>
                <Button className="w-full" disabled={!newTitle || !newDate}
                  onClick={() => createEvent.mutate({
                    title: newTitle, eventDate: newDate,
                    eventTime: newTime || undefined, type: newType as any,
                  })}>
                  추가
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 캘린더 그리드 */}
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
          {["일", "월", "화", "수", "목", "금", "토"].map(d => (
            <div key={d} className="bg-muted p-2 text-center text-xs font-medium">{d}</div>
          ))}
          {days.map((day, i) => (
            <div key={i} className={`bg-background min-h-[100px] p-1 ${!day ? "bg-muted/30" : ""} ${isCurrentMonth && day === todayDay ? "ring-2 ring-blue-500 ring-inset" : ""}`}>
              {day && (
                <>
                  <span className={`text-xs font-medium ${i % 7 === 0 ? "text-red-500" : i % 7 === 6 ? "text-blue-500" : ""}`}>
                    {day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {(eventsByDate[String(day)] || []).slice(0, 3).map((ev: any) => (
                      <div key={ev.id}
                        className={`text-[10px] px-1 py-0.5 rounded truncate cursor-pointer group relative ${TYPE_COLORS[ev.type] || TYPE_COLORS.memo}`}>
                        {ev.eventTime && <span className="font-medium">{ev.eventTime} </span>}
                        {ev.title}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteEvent.mutate({ id: ev.id }); }}
                          className="absolute right-0 top-0 hidden group-hover:block p-0.5">
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                    {(eventsByDate[String(day)]?.length || 0) > 3 && (
                      <span className="text-[10px] text-muted-foreground">+{eventsByDate[String(day)].length - 3}개</span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
