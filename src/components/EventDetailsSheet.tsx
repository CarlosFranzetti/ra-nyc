import { format, parseISO } from "date-fns";
import { Users, MapPin, Clock, ExternalLink, X } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { EventThumb } from "@/components/EventThumb";
import { formatTime } from "@/lib/formatTime";
import type { Event } from "@/types/event";

interface EventDetailsSheetProps {
  event: Event | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEEE, MMMM d");
  } catch {
    return dateStr;
  }
}

export function EventDetailsSheet({
  event,
  open,
  onOpenChange,
}: EventDetailsSheetProps) {
  if (!event) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="relative overflow-y-auto">
          <DrawerClose asChild>
            <button
              aria-label="Close"
              className="absolute top-3 right-3 z-10 bg-background/80 backdrop-blur-sm rounded-full p-2 text-foreground active:scale-95 transition-transform"
            >
              <X className="w-5 h-5" />
            </button>
          </DrawerClose>

          <div className="w-full aspect-square max-h-[40vh] bg-muted overflow-hidden">
            <EventThumb
              imageUrl={event.imageUrl}
              alt={event.title}
              fallbackLabel={event.venue.name}
              fallbackTextClass="text-6xl"
              eager
            />
          </div>

          <div className="px-4 py-5 space-y-4">
            {event.isPick && (
              <div className="inline-block bg-primary text-primary-foreground text-xs font-semibold px-2 py-1 rounded glow-primary-sm">
                RA PICK
              </div>
            )}

            <DrawerTitle className="text-xl font-bold text-foreground leading-tight text-left">
              {event.title}
            </DrawerTitle>

            {event.pickBlurb && (
              <p className="text-sm text-muted-foreground italic">
                &ldquo;{event.pickBlurb}&rdquo;
              </p>
            )}

            <div className="flex items-center gap-2 text-sm text-foreground">
              <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span>
                {formatDate(event.date)}
                {event.startTime && ` · ${formatTime(event.startTime)}`}
                {event.endTime && ` – ${formatTime(event.endTime)}`}
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm text-foreground">
              <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span>{event.venue.name}</span>
            </div>

            {event.attending > 0 && (
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span>{event.attending.toLocaleString()} going</span>
              </div>
            )}

            {event.artists.length > 0 && (
              <div className="pt-2 border-t border-border">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Lineup
                </h3>
                {/* Chips, not a comma list — this is where tapping a DJ to play
                    their sets will attach (ROADMAP.md §2). */}
                <div className="flex flex-wrap gap-2">
                  {event.artists.map((artist) => (
                    <span
                      key={artist}
                      className="text-sm bg-secondary text-secondary-foreground px-2 py-1 rounded"
                    >
                      {artist}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 pb-safe">
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold text-sm transition-smooth hover:opacity-90 active:scale-[0.99]"
              >
                View on RA
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
