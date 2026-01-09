import { Skeleton } from "@/components/ui/skeleton";

export function EventSkeleton() {
  return (
    <div className="bg-card rounded-xl overflow-hidden border border-border/50">
      <Skeleton className="aspect-[16/9] w-full" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <div className="flex gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
