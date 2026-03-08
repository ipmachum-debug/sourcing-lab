import { Skeleton } from './ui/skeleton';

export function DashboardLayoutSkeleton() {
  return (
    <div className="flex min-h-screen" style={{ background: 'linear-gradient(180deg, #fdf2f8 0%, #faf5ff 50%, #fdf2f8 100%)' }}>
      {/* Sidebar skeleton */}
      <div className="w-[260px] border-r border-pink-100/50 bg-white/80 backdrop-blur p-4 space-y-6">
        <div className="flex items-center gap-3 px-2">
          <Skeleton className="h-8 w-8 rounded-xl bg-pink-100" />
          <Skeleton className="h-5 w-28 rounded-lg bg-pink-100" />
        </div>

        <div className="space-y-2 px-2">
          <Skeleton className="h-10 w-full rounded-xl bg-pink-50" />
          <Skeleton className="h-10 w-full rounded-xl bg-purple-50" />
          <Skeleton className="h-10 w-full rounded-xl bg-pink-50" />
          <Skeleton className="h-10 w-full rounded-xl bg-purple-50" />
          <Skeleton className="h-10 w-full rounded-xl bg-pink-50" />
        </div>

        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex items-center gap-3 px-1">
            <Skeleton className="h-9 w-9 rounded-full bg-gradient-to-br from-pink-100 to-purple-100" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20 rounded bg-pink-100" />
              <Skeleton className="h-2 w-32 rounded bg-purple-50" />
            </div>
          </div>
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 p-6 space-y-5">
        <Skeleton className="h-10 w-48 rounded-xl bg-pink-100" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 rounded-2xl bg-gradient-to-br from-pink-50 to-white" />
          <Skeleton className="h-28 rounded-2xl bg-gradient-to-br from-purple-50 to-white" />
          <Skeleton className="h-28 rounded-2xl bg-gradient-to-br from-fuchsia-50 to-white" />
          <Skeleton className="h-28 rounded-2xl bg-gradient-to-br from-rose-50 to-white" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-60 rounded-2xl bg-gradient-to-br from-pink-50 to-white" />
          <Skeleton className="h-60 rounded-2xl bg-gradient-to-br from-purple-50 to-white" />
        </div>
      </div>
    </div>
  );
}
