/**
 * Routes an RA image through our own `/api/image` function.
 *
 * Used only as a fallback when the CDN refuses a direct browser request —
 * see `EventThumb` and `api/image.ts`.
 */
export function proxiedImageUrl(absoluteUrl: string): string {
  return `/api/image?u=${encodeURIComponent(absoluteUrl)}`;
}
