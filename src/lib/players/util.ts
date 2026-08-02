const pending = new Map<string, Promise<void>>();

/**
 * Loads a provider SDK once, no matter how many sets get played.
 *
 * Cached by src so switching between two SoundCloud sets doesn't re-fetch the
 * widget API. A rejected load is evicted so a later attempt can retry — a
 * player that stays broken for the session because of one flaky request is
 * worse than a second request.
 */
export function loadScript(src: string): Promise<void> {
  const existing = pending.get(src);
  if (existing) return existing;

  const load = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      pending.delete(src);
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(el);
  });

  pending.set(src, load);
  return load;
}

/** Overrides query params on an embed URL without rebuilding it by hand. */
export function withParams(
  url: string,
  params: Record<string, string>,
): string {
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * A 1×1 iframe that is invisible but still *rendered*.
 *
 * `display:none` and off-screen positioning both risk browsers treating the
 * player as backgrounded and suspending playback, which is the one thing this
 * feature cannot tolerate. So it stays in the viewport at effectively zero
 * size, with pointer events off so it can never steal a tap.
 */
export function createHiddenIframe(src: string, title: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = title;
  iframe.allow = "autoplay; encrypted-media";
  iframe.setAttribute("frameborder", "0");
  iframe.style.cssText =
    "width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  return iframe;
}
