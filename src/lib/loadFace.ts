import { FACE_OPTIONS, type Face } from "@/types/preferences";

const loaded = new Set<Face>();

/**
 * Injects the stylesheet for one optional typeface, once, the first time it is
 * chosen. `display=swap` is in the href, so text shows in the ladder face and
 * swaps when the file lands. "ladder" needs nothing: its faces are in index.html.
 */
export function loadFace(face: Face): void {
  const option = FACE_OPTIONS.find((o) => o.value === face);
  if (!option?.href || loaded.has(face)) return;
  loaded.add(face);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = option.href;
  document.head.appendChild(link);
}
