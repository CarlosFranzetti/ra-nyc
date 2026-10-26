import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { EventThumb } from "@/components/EventThumb";
import { cn } from "@/lib/utils";

interface FlyerViewerProps {
  imageUrl: string | null;
  alt: string;
  fallbackLabel: string;
  open: boolean;
  onClose: () => void;
}

/**
 * The flyer at full size, over everything.
 *
 * Opened by holding the flyer in the event sheet (see `useLongPress`). The
 * sheet shows the flyer cropped to a square at 40vh, which is the right size
 * for recognising a night and the wrong size for reading the small type on it
 * — the lineup, the door time, the address — which is what a flyer is *for*.
 * This shows the whole image, uncropped, as large as the screen allows.
 *
 * Portalled to <body>, and that is load-bearing in two ways. The sheet is a
 * vaul portal whose content is not transformed, but the page beneath *is*
 * (the iOS present idiom scales it), and a `fixed` element inside a
 * transformed ancestor is positioned against that ancestor rather than the
 * viewport. And the sheet's scroller has `overflow-y: auto`, which would clip
 * a child that tries to be larger than it. Outside both, `fixed inset-0`
 * means what it says.
 *
 * z-[90]: above the sheets (50/60), the transport (70) and search (80), below
 * the hidden screen (100). Nothing but a deliberate exit should be able to
 * appear over a flyer you asked to see.
 *
 * Dismissed by a tap anywhere, the X, or Escape. Stays mounted through the
 * exit animation so the fade-out actually plays — the same `present`/`leaving`
 * pattern as the search overlay, on the same `--in`/`--out` clock.
 */
export function FlyerViewer({
  imageUrl,
  alt,
  fallbackLabel,
  open,
  onClose,
}: FlyerViewerProps) {
  const [present, setPresent] = useState(open);
  const [leaving, setLeaving] = useState(false);

  /**
   * Inert until the gesture that opened it has finished.
   *
   * The viewer is summoned by a hold, which means it appears *while the finger
   * is still down* — and it appears on top, so the release lands here instead
   * of on the flyer. Left alone, that release was a tap on the viewer's
   * backdrop: it closed the viewer the instant it opened, the flyer never saw
   * its own pointerup (so the hold hook could not swallow the trailing click),
   * and vaul — which started tracking a drag on that pointerdown — never saw
   * the release either and was left mid-gesture. The suite caught it as "a tap
   * on the flyer no longer returns to the listings".
   *
   * So the viewer has no pointer-events until the first pointerup after it
   * opens. That release passes through to the element the gesture started on,
   * everything there finishes cleanly, and only *then* does the viewer start
   * taking taps. A 600ms backstop arms it anyway, for the case where it was
   * opened without a pointer at all.
   */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!open) {
      setArmed(false);
      return undefined;
    }
    const arm = () => setArmed(true);
    window.addEventListener("pointerup", arm, { once: true });
    window.addEventListener("pointercancel", arm, { once: true });
    const backstop = window.setTimeout(arm, 600);
    return () => {
      window.removeEventListener("pointerup", arm);
      window.removeEventListener("pointercancel", arm);
      window.clearTimeout(backstop);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setPresent(true);
      setLeaving(false);
      return undefined;
    }
    if (!present) return undefined;
    setLeaving(true);
    const out = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--out"),
    );
    const timer = window.setTimeout(
      () => {
        setPresent(false);
        setLeaving(false);
      },
      Number.isFinite(out) && out > 0 ? out * 1000 : 340,
    );
    return () => window.clearTimeout(timer);
  }, [open, present]);

  /**
   * Escape closes the viewer — and only the viewer.
   *
   * The sheet underneath is a Radix dialog, and Radix listens for Escape on
   * the document. Left to bubble, one keypress dismissed both: the flyer and
   * the event behind it, leaving you on the listings. On a phone there is no
   * Escape, so this is a desktop-only wrong, but it is wrong: closing a thing
   * you opened over a sheet must not close the sheet.
   *
   * Capture phase on window, which runs before anything on document, and
   * stopPropagation so it goes no further. It only does this while the
   * viewer is open; otherwise Escape reaches the sheet as it should.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose]);

  if (!present) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Flyer for ${alt}`}
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-[90] flex items-center justify-center bg-black/95 p-2",
        leaving ? "viewer-out" : "viewer-in",
        !armed && "pointer-events-none",
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close flyer"
        className="tap absolute right-2 top-2 rounded-full bg-background/70 text-foreground backdrop-blur-sm pt-safe"
      >
        <X className="h-[18px] w-[18px]" />
      </button>

      {/* `object-contain` overrides EventThumb's `object-cover` through
          tailwind-merge: the whole flyer, letterboxed, not a crop. */}
      <div className="max-h-full max-w-full">
        <EventThumb
          imageUrl={imageUrl}
          alt={alt}
          fallbackLabel={fallbackLabel}
          fallbackTextClass="text-6xl"
          className="max-h-[calc(100dvh-16px)] w-auto max-w-full object-contain"
          eager
        />
      </div>
    </div>,
    document.body,
  );
}
