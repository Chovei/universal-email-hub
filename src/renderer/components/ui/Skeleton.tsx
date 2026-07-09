import { cn } from '../../lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('skeleton rounded', className)} />
}

export function ThreadItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)]">
      <Skeleton className="w-8 h-8 rounded-full" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3 w-full max-w-xs" />
      </div>
    </div>
  )
}

export function MessageSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="space-y-3 pt-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  )
}
