/** Matches EventCard's geometry so nothing shifts when real data arrives. */
export function EventSkeleton() {
  return (
    <div className="flex gap-3 bg-card rounded-lg overflow-hidden border border-border/50 p-2">
      <div className="w-24 h-24 rounded-md flex-shrink-0 skeleton-glow" />
      <div className="flex-1 py-0.5 space-y-2">
        <div className="h-4 w-3/4 rounded skeleton-glow" />
        <div className="h-3 w-1/2 rounded skeleton-glow" />
        <div className="h-3 w-2/3 rounded skeleton-glow" />
      </div>
    </div>
  );
}
