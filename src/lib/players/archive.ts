import type { CreatePlayer } from "./types";

interface ArchiveFile {
  name?: string;
  format?: string;
}

/** Most playable first. Archive items carry the same set in several formats. */
const FORMAT_RANK = ["vbr mp3", "128kbps mp3", "64kbps mp3", "mp3", "ogg vorbis"];

function rankFormat(format: string | undefined): number {
  const value = (format ?? "").toLowerCase();
  const exact = FORMAT_RANK.indexOf(value);
  if (exact !== -1) return exact;
  // Archive invents bitrate-prefixed variants freely ("96Kbps MP3"), so fall
  // back to a contains check rather than losing them to the exact list.
  if (value.includes("mp3")) return FORMAT_RANK.length;
  if (value.includes("ogg")) return FORMAT_RANK.length + 1;
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Internet Archive, played natively.
 *
 * Their `/embed/` page has no control API, which would have left Archive sets
 * as the one provider you couldn't pause or scrub. But Archive is also the one
 * provider that serves the audio file directly, so we skip the embed entirely:
 * resolve the item's file list and hand the URL to an `<audio>` element. That
 * makes it the *best* behaved of the four rather than the worst.
 *
 * The metadata endpoint is keyless and CORS-open, and is only hit when an
 * Archive set is actually played.
 */
export const createArchivePlayer: CreatePlayer = async (mount, set, events) => {
  const identifier = new URL(set.url).pathname.split("/").filter(Boolean).pop();
  if (!identifier) throw new Error("Unrecognised Archive item");

  const response = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!response.ok) throw new Error("Archive metadata unavailable");
  const metadata = (await response.json()) as { files?: ArchiveFile[] };

  const playable = (metadata.files ?? [])
    .filter((file): file is ArchiveFile & { name: string } => Boolean(file.name))
    .sort((a, b) => rankFormat(a.format) - rankFormat(b.format))[0];

  if (!playable || rankFormat(playable.format) === Number.MAX_SAFE_INTEGER) {
    throw new Error("No playable audio in this Archive item");
  }

  const audio = document.createElement("audio");
  audio.src = `https://archive.org/download/${identifier}/${encodeURIComponent(
    playable.name,
  )}`;
  audio.preload = "auto";
  mount.appendChild(audio);

  const duration = () =>
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : set.duration;

  audio.addEventListener("loadedmetadata", () => events.onReady(duration()));
  audio.addEventListener("timeupdate", () =>
    events.onProgress(audio.currentTime, duration()),
  );
  audio.addEventListener("play", () => events.onPlay());
  audio.addEventListener("pause", () => events.onPause());
  audio.addEventListener("ended", () => events.onEnded());
  audio.addEventListener("error", () =>
    events.onError("This Archive recording couldn't be played."),
  );

  void audio.play().catch(() => {
    // Autoplay refused: leave it cued so the bar's play button still works.
    events.onPause();
  });

  return {
    seekable: true,
    provider: "archive",
    play: () => void audio.play().catch(() => undefined),
    pause: () => audio.pause(),
    seek: (seconds) => {
      audio.currentTime = seconds;
    },
    destroy: () => {
      audio.pause();
      // Drop the source too, or the browser keeps buffering a set nobody is
      // listening to.
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    },
  };
};
