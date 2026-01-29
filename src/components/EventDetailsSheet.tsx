import { format, parseISO } from "date-fns";
import { Users, MapPin, Clock, ExternalLink, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerClose } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import type { Event } from "@/types/event";

interface EventDetailsSheetProps {
  event: Event | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventDetailsSheet({ event, open, onOpenChange }: EventDetailsSheetProps) {
  if (!event) return null;

  const formatTime = (time: string) => {
    if (!time) return "";
    if (time.includes("T")) {
      const d = parseISO(time);
      if (Number.isNaN(d.getTime())) return "";
      return format(d, "h:mma").toLowerCase().replace(":00", "");
    }
    const [hours, minutes = "00"] = time.split(":");
    const h = Number.parseInt(hours, 10);
    if (Number.isNaN(h)) return "";
    const suffix = h >= 12 ? "pm" : "am";
    const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const mins = minutes === "00" ? "" : `:${minutes}`;
    return `${hour12}${mins}${suffix}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = parseISO(dateStr);
      return format(d, "EEEE, MMMM d");
    } catch {
      return dateStr;
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] bg-background">
        <div className="relative">
          {/* Close button */}
          <DrawerClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 z-10 bg-background/80 backdrop-blur-sm rounded-full"
            >
              <X className="w-5 h-5" />
            </Button>
          </DrawerClose>

          {/* Hero Image */}
          <div className="w-full aspect-square max-h-[40vh] bg-muted overflow-hidden">
            {event.imageUrl ? (
              <img
                src={event.imageUrl}
                alt={event.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-background">
                <span className="text-6xl font-bold text-muted-foreground/20">
                  {event.venue.name.charAt(0)}
                </span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="px-4 py-5 space-y-4 overflow-y-auto">
            {/* RA Pick Badge */}
            {event.isPick && (
              <div className="inline-block bg-primary text-primary-foreground text-xs font-semibold px-2 py-1 rounded">
                RA PICK
              </div>
            )}

            {/* Title */}
            <h2 className="text-xl font-bold text-foreground leading-tight">
              {event.title}
            </h2>

            {/* Pick Blurb */}
            {event.pickBlurb && (
              <p className="text-sm text-muted-foreground italic">
                "{event.pickBlurb}"
              </p>
            )}

            {/* Date & Time */}
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span>
                {formatDate(event.date)} · {formatTime(event.startTime)}
                {event.endTime && ` – ${formatTime(event.endTime)}`}
              </span>
            </div>

            {/* Venue */}
            <div className="flex items-center gap-2 text-sm text-foreground">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span>{event.venue.name}</span>
            </div>

            {/* Attending */}
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span>{event.attending.toLocaleString()} going</span>
            </div>

            {/* Artists */}
            {event.artists.length > 0 && (
              <div className="pt-2 border-t border-border">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Lineup
                </h3>
                <div className="flex flex-wrap gap-2">
                  {event.artists.map((artist, i) => (
                    <span
                      key={i}
                      className="text-sm bg-secondary text-secondary-foreground px-2 py-1 rounded"
                    >
                      {artist}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            <div className="pt-4">
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold text-sm transition-smooth hover:opacity-90"
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
