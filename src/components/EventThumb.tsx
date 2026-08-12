import { useLayoutEffect, useRef, useState } from "react";
import { proxiedImageUrl } from "@/lib/images";
import { cn } from "@/lib/utils";

interface EventThumbProps {
  imageUrl: string | null;
  alt: string;
  /** Shown as a large initial when there's no usable image. */
  fallbackLabel: string;
  className?: string;
  fallbackTextClass?: string;
  eager?: boolean;
}

type Stage = "direct" | "proxied" | "failed";

/**
 * RA flyer with a proxy fallback and a graceful placeholder.
 *
 * Tries the RA CDN directly first — fast, and costs us no bandwidth. If that
 * fails (hotlink protection on `Referer`, which a browser cannot set) it retries
 * through `/api/image`, which can. Only if both fail does it fall back to the
 * venue initial, which is also what shows when RA has no flyer at all.
 */
export function EventThumb({
  imageUrl,
  alt,
  fallbackLabel,
  className,
  fallbackTextClass = "text-xl",
  eager = false,
}: EventThumbProps) {
  const [stage, setStage] = useState<Stage>("direct");
  const imgRef = useRef<HTMLImageElement>(null);

  // `eager` (used by the detail sheet's single hero flyer) already renders
  // `loading="eager"` below. Everything else — the list, one card per event —
  // starts `lazy`, so a long night doesn't queue fifty image fetches ahead of
  // the text that actually answers "what's on". But the handful of cards that
  // are on screen the moment the list paints deserve the same eager treatment,
  // and there's no index to hand them one: `HomePage` owns the list and this
  // component doesn't reach into it. So it asks the DOM instead — synchronously,
  // before paint, so the browser's own lazy-load scheduler never gets a head
  // start on a card that was visible from the first frame.
  useLayoutEffect(() => {
    if (eager) return;
    const img = imgRef.current;
    if (!img) return;
    if (img.getBoundingClientRect().top < window.innerHeight) {
      img.loading = "eager";
      img.fetchPriority = "high";
    }
  }, [eager, stage]);

  if (!imageUrl || stage === "failed") {
    return (
      <div
        className={cn(
          "w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-background",
          className,
        )}
      >
        <span className={cn("font-bold text-muted-foreground/30", fallbackTextClass)}>
          {fallbackLabel.charAt(0)}
        </span>
      </div>
    );
  }

  return (
    <img
      // Remounting on stage change is deliberate: without a changing key the
      // browser may not re-request after an error.
      key={stage}
      ref={imgRef}
      src={stage === "direct" ? imageUrl : proxiedImageUrl(imageUrl)}
      alt={alt}
      className={cn("w-full h-full object-cover", className)}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      // Some CDNs reject a cross-origin Referer but allow none at all; this
      // alone often makes the direct load succeed.
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === "direct" ? "proxied" : "failed"))}
    />
  );
}
