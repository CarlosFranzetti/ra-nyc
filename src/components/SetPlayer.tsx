import { useState } from "react";
import { Play } from "lucide-react";
import {
  PROVIDER_EMBED_HEIGHT,
  PROVIDER_LABELS,
  type ArtistSet,
} from "@/types/artist";

interface SetPlayerProps {
  set: ArtistSet;
}

/**
 * Provider-agnostic embed.
 *
 * Every provider gives us a plain iframe URL, so playback needs no SDK and no
 * per-provider JS — only a height, since a SoundCloud widget and a YouTube
 * player disagree about how tall they should be.
 *
 * The iframe mounts only after an explicit tap. Mobile Safari blocks autoplay
 * regardless, so a pre-mounted third-party player costs bandwidth and scroll
 * performance to save a tap the user still has to make.
 */
export function SetPlayer({ set }: SetPlayerProps) {
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="glow-primary-hover flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 py-6 text-sm font-medium text-foreground transition-smooth active:scale-[0.99]"
      >
        <Play className="h-5 w-5 text-primary" />
        Play on {PROVIDER_LABELS[set.provider]}
      </button>
    );
  }

  return (
    <iframe
      title={set.title}
      src={set.embedUrl}
      width="100%"
      height={PROVIDER_EMBED_HEIGHT[set.provider]}
      frameBorder="0"
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="no-referrer-when-downgrade"
      className="w-full rounded-lg bg-secondary"
    />
  );
}
