import type { SetProvider } from "@/types/artist";
import type { CreatePlayer } from "./types";
import { createArchivePlayer } from "./archive";
import { createMixcloudPlayer } from "./mixcloud";
import { createSoundcloudPlayer } from "./soundcloud";
import { createYoutubePlayer } from "./youtube";

/**
 * Adapters are loaded on demand so no provider SDK is in the initial bundle —
 * most sessions never play anything, and the ones that do only ever touch one
 * or two providers.
 */
const LOADERS: Record<SetProvider, () => Promise<CreatePlayer>> = {
  soundcloud: async () => createSoundcloudPlayer,
  mixcloud: async () => createMixcloudPlayer,
  archive: async () => createArchivePlayer,
  youtube: async () => createYoutubePlayer,
};

export function playerFor(provider: SetProvider): Promise<CreatePlayer> {
  return LOADERS[provider]();
}

export type { PlayerEvents, PlayerHandle } from "./types";
