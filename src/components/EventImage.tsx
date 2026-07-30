import { useState } from "react";
import { proxiedRAImageUrl } from "@/lib/raImage";

interface EventImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Eager for the sheet's hero image, lazy for cards in a long list. */
  eager?: boolean;
}

type Stage = "direct" | "proxied" | "failed";

/**
 * RA flyer image with a proxy fallback.
 *
 * Tries the RA CDN directly — fast, and costs us no bandwidth. If that fails
 * (hotlink protection is the usual reason, and a browser can't send the
 * `Referer` the CDN wants), it retries through `/api/image`, which can. Only
 * after both fail does the element disappear, since plenty of RA listings
 * genuinely have no usable flyer and an empty slot beats a broken icon.
 */
export default function EventImage({
  src,
  alt,
  className,
  eager = false,
}: EventImageProps) {
  const [stage, setStage] = useState<Stage>("direct");

  if (stage === "failed") return null;

  return (
    <img
      // Remounting on stage change is deliberate: without a changing key the
      // browser may not re-request after an error.
      key={stage}
      src={stage === "direct" ? src : proxiedRAImageUrl(src)}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      // Some CDNs reject a cross-origin Referer but allow none at all; this
      // alone often makes the direct load succeed.
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === "direct" ? "proxied" : "failed"))}
    />
  );
}
