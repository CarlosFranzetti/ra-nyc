import { useEffect, useRef, useState } from "react";
import {
  ListMusic,
  Loader,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Ticket,
  X,
} from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
import { hostOf, outbound } from "@/lib/analytics";
import { formatClock } from "@/lib/formatClock";
import { shouldOfferTickets } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { PROVIDER_LABELS } from "@/types/artist";

/**
 * Every transport button, at the one size the whole app uses for a control.
 *
 * `.tap` is 44px in literal px — see index.css. These were 32px, which is
 * comfortable with a mouse and mean with a thumb, on the one row of the app
 * most likely to be used one-handed and walking.
 */
const controlClass =
  "tap rounded-full text-foreground " +
  "transition-smooth active:scale-90 disabled:opacity-30 disabled:active:scale-100";

/**
 * The transport bar, docked to the bottom.
 *
 * `fixed` rather than in flow: at the bottom of a `min-h-screen` page there is
 * no "last element" to stick to, and a bar that scrolls away is not a
 * persistent player. The page and the sheets both clear it using `--player-h`,
 * which this publishes from its own measured height.
 *
 * Progress sits above the controls — at the bottom of the screen the scrubber
 * wants to be the furthest thing from the home indicator, not sandwiched
 * against it.
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
    source,
    listened,
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
    jumpTo,
    removeAt,
  } = usePlayer();

  const ticketsVisible = shouldOfferTickets(source, listened);

  const barRef = useRef<HTMLDivElement>(null);
  /**
   * The playlist panel, closed by default.
   *
   * Closed, because the transport's job at rest is to say what is playing and
   * let you stop it — a list open over the listings would be a fifth of the
   * screen spent on something you asked for once. Opening it is one tap and it
   * stays open until you close it.
   */
  const [listOpen, setListOpen] = useState(false);
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

  // The panel is meaningless with a single set, and the button that opens it
  // would be a control that reveals a list of one.
  const hasPlaylist = queue.length > 1;

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
      // A party preview is a different thing from one artist's catalogue, and
      // the bar is the only place that says which you are hearing.
      source ? `at ${source.label}` : PROVIDER_LABELS[current.provider],
      queue.length > 1 ? `${index + 1} of ${queue.length}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    /* z-[70] puts the bar above both drawer layers (z-50 base, z-[60] stacked).
       A transport you can't reach while a sheet is open isn't a transport, and
       the sheets sit on top of --player-h so nothing ends up hidden under it.

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
      /* A primary-coloured top edge rather than the same hairline border every
         other surface uses. The bar was the one genuinely live thing on screen
         and it was dressed as page chrome — at a glance it read as a footer, so
         people scrolled past a set that was actually playing. Two pixels in the
         theme's own accent, with the glow the rest of the app already uses,
         costs no height and makes it the loudest edge in the layout.

         `player-live` sits in index.css because the glow is a box-shadow off
         the *top* edge only, which Tailwind cannot express. */
      className={cn(
        // Slides up when a set starts and back down when it stops, like every
        // other surface in the app. It used to appear and vanish between two
        // frames, which beside four sheets that slide read as a glitch — and a
        // transport that materialises over the listings without warning is the
        // one element that most needs to announce itself arriving.
        "player-live pointer-events-auto fixed inset-x-0 bottom-0 z-[70] border-t-2 border-primary/70 bg-background/95 pb-safe backdrop-blur-lg",
        "player-enter",
      )}
    >
      {/* The playlist.

          Above the transport rather than below it: the controls stay where the
          thumb already expects them, and the list grows upward into the page
          instead of pushing the buttons around. Capped and scrollable, because
          a preview of a twelve-name bill would otherwise be the whole screen.

          `--player-h` is measured from this element's box, so the page and the
          sheets reserve room for the panel too and nothing ends up underneath
          it while it is open. */}
      {hasPlaylist && listOpen && (
        <div className="shell max-h-[38vh] overflow-y-auto overscroll-contain border-b border-border/50 px-2 py-1.5">
          <ul aria-label="Playlist" className="space-y-0.5">
            {queue.map((set, position) => {
              const live = position === index;
              return (
                <li key={`${set.id}-${position}`} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => jumpTo(position)}
                    aria-current={live ? "true" : undefined}
                    className={cn(
                      "tap-row min-w-0 flex-1 gap-2 rounded-md px-2 text-left transition-smooth active:scale-[0.99]",
                      live ? "bg-secondary" : "hover:bg-accent active:bg-accent",
                    )}
                  >
                    {/* The live row is marked by the same triangle the transport
                        uses rather than by a number: a position in a queue you
                        can reorder by deleting is not a fact worth printing. */}
                    <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
                      {live ? (
                        <Play className="h-2.5 w-2.5 fill-primary text-primary" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[0.6875rem] leading-tight",
                          live ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {set.title}
                      </span>
                    </span>
                  </button>

                  {/* No remove on the live row. Taking away what is currently
                      playing is a different action from tidying the queue, and
                      the transport already has a stop button for it. */}
                  {!live && (
                    <button
                      type="button"
                      onClick={() => removeAt(position)}
                      aria-label={`Remove ${set.title} from the playlist`}
                      className="tap rounded-full text-muted-foreground transition-smooth active:scale-90 active:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Progress, as the bar's own top edge.

          It used to be a row of its own: two 36px clock labels flanking a
          track, about 26px of a 60px transport spent on a number nobody reads
          while walking. The elapsed time is a *reference*, not a control, and
          the control it was attached to works perfectly well as a line.

          So the line is the line. Full width, three pixels, sitting on the
          bar's top edge where the eye already is because the accent border is
          there — and the clocks appear only while you are actually dragging,
          which is the one moment the number matters. That is the whole saving:
          a row back, and the scrubber is now wider than it has ever been.

          The input keeps a 20px hit area (see `.player-range`) despite the 3px
          track, because a three-pixel target is not a target. */}
      <div className="relative">
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
          aria-valuetext={`${formatClock(shown)} of ${formatClock(duration)}`}
          style={{ "--progress": `${percent}%` } as React.CSSProperties}
          className="player-range absolute inset-x-0 -top-[9px] z-10 w-full"
        />

        {/* Only while dragging. A clock that is always on screen is a clock you
            stop seeing; one that appears under your thumb at the moment you ask
            for it is an answer. */}
        {scrubbing !== null && (
          <div className="pointer-events-none absolute inset-x-0 -top-7 flex justify-center">
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.625rem] font-medium tabular-nums text-foreground shadow-lg">
              {formatClock(shown)} / {formatClock(duration)}
            </span>
          </div>
        )}
      </div>

      {/* No vertical padding: the 56px play button sets the row's height on its
          own, and padding on top of it was making the bar *taller* than the two
          rows it replaced — which is the opposite of the point. 56px against
          the 60 it used to be, with a play button nearly twice the size. */}
      <div className="shell flex items-center gap-1 px-2">
        <button
          onClick={previous}
          disabled={!hasPrevious}
          aria-label="Previous mix"
          className={controlClass}
        >
          <SkipBack className="h-[18px] w-[18px]" />
        </button>

        {/* The one control on this bar anybody aims at in a hurry, so it is the
            one that is bigger than the standard 44 rather than equal to it.
            56px with a 24px glyph — the icon was 16px inside 32px, which is a
            play button drawn at the size of a label. */}
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-[56px] w-[56px] flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-smooth active:scale-90 active:bg-primary"
        >
          {loading ? (
            <Loader className="h-6 w-6 animate-spin" />
          ) : playing ? (
            <Pause className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6" />
          )}
        </button>

        <button
          onClick={next}
          disabled={!hasNext}
          aria-label="Next mix"
          className={controlClass}
        >
          <SkipForward className="h-[18px] w-[18px]" />
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

        {/* Earned, not shown.
            It appears only once someone has actually listened to a party
            preview for a while — `listened` ticks only while audio is playing,
            so a phone paused in a pocket never gets here. That is the whole
            ethic of it: at a minute in, "where do I get tickets" is a question
            the listener now has, and answering it is help. Shown at the start it
            would be an advert, and the app would have to be ignored to be used. */}
        {ticketsVisible && source && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Tickets for ${source.label} on Resident Advisor`}
            onClick={() =>
              outbound("tickets", { host: hostOf(source.url), from: "player" })
            }
            className="press flex flex-shrink-0 items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-1 text-[0.625rem] font-medium text-primary"
          >
            <Ticket className="h-3 w-3" />
            Tickets
          </a>
        )}

        {hasPlaylist && (
          <button
            onClick={() => setListOpen((open) => !open)}
            aria-label={listOpen ? "Hide playlist" : "Show playlist"}
            aria-expanded={listOpen}
            className={cn(
              controlClass,
              "relative",
              listOpen ? "text-primary" : "text-muted-foreground",
            )}
          >
            <ListMusic className="h-[18px] w-[18px]" />
            {/* How many are waiting, which is the one number worth having on a
                closed panel — it is the difference between "there is a queue"
                and "there is a queue with nine things in it". */}
            <span className="absolute right-0 top-0.5 rounded-full bg-primary px-1 text-[0.5rem] font-semibold leading-[0.9rem] text-primary-foreground">
              {queue.length}
            </span>
          </button>
        )}

        <button
          onClick={stop}
          aria-label="Close player"
          className={cn(controlClass, "text-muted-foreground")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
