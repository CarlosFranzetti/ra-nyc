import { Skeleton } from "@/components/ui/skeleton";

export function EventSkeleton() {
  return (
    <div className="flex gap-3 bg-card rounded-lg overflow-hidden border border-border/50 p-2">
      <Skeleton className="w-24 h-24 rounded-md flex-shrink-0" />
      <div className="flex-1 py-0.5 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
