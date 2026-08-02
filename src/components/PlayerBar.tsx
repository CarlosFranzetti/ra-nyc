import { useEffect, useRef, useState } from "react";
import { Loader, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
import { formatClock } from "@/lib/formatClock";
import { cn } from "@/lib/utils";
import { PROVIDER_LABELS } from "@/types/artist";

const controlClass =
  "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-foreground " +
  "transition-smooth active:scale-90 disabled:opacity-30 disabled:active:scale-100";

/**
 * The transport bar.
 *
 * Sits in normal flow at the very top of the page and sticks there, rather than
 * being `fixed` — so it takes up its own space and nothing has to be padded
 * down to compensate. It publishes its height as `--player-h` for the one
 * element that does need to know: the header, which sticks directly beneath it.
 *
 * It holds no player. The iframe or audio element lives in a body-level host
 * owned by PlayerProvider, which is what lets a set keep playing while sheets
 * open and close over the top of it.
 */
export function PlayerBar() {
  const {
    current,
    artistName,
    queue,
    index,
    playing,
    loading,
    position,
    duration,
    seekable,
    error,
    hasNext,
    hasPrevious,
    toggle,
    next,
    previous,
    seek,
    stop,
  } = usePlayer();

  const barRef = useRef<HTMLDivElement>(null);
  // While dragging, the thumb follows the finger instead of the playhead —
  // otherwise incoming progress events fight the drag and it stutters.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const active = Boolean(current);

  useEffect(() => {
    const root = document.documentElement;
    const element = barRef.current;
    if (!active || !element) {
      root.style.setProperty("--player-h", "0px");
      return undefined;
    }
    const publish = () =>
      root.style.setProperty(
        "--player-h",
        `${element.getBoundingClientRect().height}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.setProperty("--player-h", "0px");
    };
  }, [active]);

  if (!current) return null;

  const length = duration ?? 0;
  const shown = Math.min(scrubbing ?? position, length || Number.MAX_SAFE_INTEGER);
  // Not while loading: there is no player to seek yet, so the handle would
  // move and playback wouldn't.
  const canSeek = seekable && length > 0 && !loading;
  const percent = length > 0 ? Math.min(100, (shown / length) * 100) : 0;

  const commitScrub = () => {
    if (scrubbing === null) return;
    seek(scrubbing);
    setScrubbing(null);
  };

  const subtitle =
    error ??
    [
      artistName,
      PROVIDER_LABELS[current.provider],
      queue.length > 1 ? `${index + 1} of ${queue.length}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    /* z-[70] puts the bar above both drawer layers (z-50 base, z-[60] stacked).
       A transport you can't reach while a sheet is open isn't a transport, and
       the sheets cap their own height against --player-h so nothing ends up
       hidden underneath it.

       Painting above isn't enough on its own, though. An open drawer is a modal:
       Radix sets pointer-events:none on <body> so everything outside the dialog
       stops responding, which left the bar visible but dead to taps. It opts
       itself back in — deliberately, because a media transport is exactly the
       kind of global control that should outlive a modal. */
    <div
      ref={barRef}
      /* And with the bar interactive again, a tap on it counts as a pointer-down
         *outside* the open drawer, which is Radix's cue to dismiss. Stopping
         propagation keeps skipping a track from also closing the sheet you were
         reading. */
      onPointerDown={(event) => event.stopPropagation()}
      className="pointer-events-auto sticky top-0 z-[70] border-b border-border/50 bg-background/95 pt-safe backdrop-blur-lg"
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <button
          onClick={previous}
          disabled={!hasPrevious}
          aria-label="Previous mix"
          className={controlClass}
        >
          <SkipBack className="h-4 w-4" />
        </button>

        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            controlClass,
            "bg-primary text-primary-foreground active:bg-primary",
          )}
        >
          {loading ? (
            <Loader className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>

        <button
          onClick={next}
          disabled={!hasNext}
          aria-label="Next mix"
          className={controlClass}
        >
          <SkipForward className="h-4 w-4" />
        </button>

        <div className="mx-1 min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-medium leading-tight text-foreground">
            {current.title}
          </p>
          <p
            className={cn(
              "truncate text-[0.6875rem] leading-tight",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {subtitle}
          </p>
        </div>

        <button
          onClick={stop}
          aria-label="Close player"
          className={cn(controlClass, "text-muted-foreground")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="w-10 flex-shrink-0 text-right text-[0.625rem] tabular-nums text-muted-foreground">
          {formatClock(position)}
        </span>
        <input
          type="range"
          min={0}
          max={length || 1}
          step={1}
          value={shown}
          disabled={!canSeek}
          onChange={(event) => setScrubbing(Number(event.target.value))}
          onPointerUp={commitScrub}
          onPointerCancel={commitScrub}
          onKeyUp={commitScrub}
          aria-label="Seek"
          style={{ "--progress": `${percent}%` } as React.CSSProperties}
          className="player-range min-w-0 flex-1"
        />
        <span className="w-10 flex-shrink-0 text-[0.625rem] tabular-nums text-muted-foreground">
          {formatClock(duration)}
        </span>
      </div>
    </div>
  );
}
