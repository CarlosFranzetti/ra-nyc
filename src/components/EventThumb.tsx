import { useState } from "react";
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
      src={stage === "direct" ? imageUrl : proxiedImageUrl(imageUrl)}
      alt={alt}
      className={cn("w-full h-full object-cover", className)}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      // Some CDNs reject a cross-origin Referer but allow none at all; this
      // alone often makes the direct load succeed.
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === "direct" ? "proxied" : "failed"))}
    />
  );
}
