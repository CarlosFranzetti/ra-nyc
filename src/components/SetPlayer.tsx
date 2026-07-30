import { useState } from "react";
import { Play } from "lucide-react";
import type { ArtistSet } from "@/types/artist";

interface SetPlayerProps {
  set: ArtistSet;
}

/**
 * Mixcloud widget embed.
 *
 * Mixcloud is the player because it's the only source we can both search and
 * embed without an API key — SoundCloud's registration has been closed for
 * years, so we can only link out to it.
 *
 * The iframe is mounted only after an explicit tap. Mobile Safari blocks
 * autoplay anyway, so a pre-mounted player would be a third-party iframe's worth
 * of cost for a tap the user still has to make.
 */
export function SetPlayer({ set }: SetPlayerProps) {
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 py-6 text-sm font-medium text-foreground transition-smooth glow-primary-hover active:scale-[0.99]"
      >
        <Play className="h-5 w-5 text-primary" />
        Play this set
      </button>
    );
  }

  return (
    <iframe
      title={set.title}
      // `light=0` matches the dark UI; hide_cover keeps the widget compact.
      src={`https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(
        set.key,
      )}&hide_cover=1&light=0&autoplay=1`}
      width="100%"
      height="120"
      frameBorder="0"
      allow="autoplay"
      referrerPolicy="no-referrer-when-downgrade"
      className="w-full rounded-lg bg-secondary"
    />
  );
}
