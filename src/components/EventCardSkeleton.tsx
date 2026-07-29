/**
 * Placeholder card shown while a day loads.
 *
 * Matches EventCard's geometry (including the density-driven image height) so
 * the list doesn't jump when real data lands — the point of a skeleton over a
 * spinner is that nothing moves on arrival.
 */
export default function EventCardSkeleton() {
  return (
    <div className="bg-card rounded-lg overflow-hidden border border-border animate-pulse">
      <div className="w-full bg-secondary" style={{ height: "var(--card-image-h)" }} />
      <div className="p-[var(--card-pad)] space-y-2">
        <div className="h-3.5 w-3/4 rounded bg-secondary" />
        <div className="h-3 w-1/2 rounded bg-secondary" />
        <div className="h-3 w-2/5 rounded bg-secondary" />
      </div>
    </div>
  );
}
