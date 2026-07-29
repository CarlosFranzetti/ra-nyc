import { format, parseISO } from "date-fns";
import Sheet from "@/components/Sheet";
import EventImage from "@/components/EventImage";
import { resolveRAImageUrl } from "@/lib/raImage";
import type { RAEvent } from "@/types/event";

interface EventDetailsSheetProps {
  event: RAEvent | null;
  onClose: () => void;
}

function formatTime(value: string): string {
  try {
    return format(parseISO(value), "h:mm a");
  } catch {
    return value;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

export default function EventDetailsSheet({
  event,
  onClose,
}: EventDetailsSheetProps) {
  const imageUrl = resolveRAImageUrl(event?.images?.[0]?.filename);

  return (
    <Sheet open={event !== null} onClose={onClose} title={event?.title ?? "Event"}>
      {event && (
        <div className="space-y-4">
          {imageUrl && (
            <div
              className="w-full rounded-lg overflow-hidden bg-secondary"
              style={{ height: "var(--card-image-h)" }}
            >
              <EventImage
                src={imageUrl}
                alt={event.title}
                className="w-full h-full object-cover"
                eager
              />
            </div>
          )}

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-foreground leading-tight">
              {event.title}
            </h3>
            {event.pick && (
              <span className="inline-block text-[10px] font-medium bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                RA Pick
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {event.venue && <Row label="Venue" value={event.venue.name} />}
            {event.venue?.area && <Row label="Area" value={event.venue.area.name} />}
            <Row
              label="Time"
              value={`${formatTime(event.startTime)} – ${formatTime(event.endTime)}`}
            />
          </div>

          {event.pick?.blurb && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {event.pick.blurb}
            </p>
          )}

          {event.artists.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Lineup
              </h4>
              {/* Chips rather than a comma list: this is where tapping a DJ to
                  play their sets will hang off (see ROADMAP.md §2). */}
              <div className="flex flex-wrap gap-1.5">
                {event.artists.map((artist) => (
                  <span
                    key={artist.id || artist.name}
                    className="text-xs bg-secondary text-foreground border border-border rounded-full px-2.5 py-1"
                  >
                    {artist.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <a
            href={`https://ra.co${event.contentUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center text-xs font-medium bg-primary text-primary-foreground rounded-md py-2.5 active:scale-[0.99] transition-transform"
          >
            View on Resident Advisor
          </a>
        </div>
      )}
    </Sheet>
  );
}
