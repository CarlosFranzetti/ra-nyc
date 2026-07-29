const RA_IMAGE_HOST = "https://images.ra.co";

/**
 * Resolves RA's `images[].filename` to a usable URL.
 *
 * That field is not consistently a filename: RA returns an absolute URL
 * (`https://images.ra.co/…`) for most events and a bare path for some. The
 * original code prefixed the host unconditionally, which turns the absolute
 * form into `https://images.ra.co/https://images.ra.co/…` and 404s — so images
 * silently failed to load. Handle both shapes.
 */
export function resolveRAImageUrl(
  filename: string | null | undefined,
): string | null {
  const trimmed = filename?.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  return `${RA_IMAGE_HOST}/${trimmed.replace(/^\/+/, "")}`;
}
