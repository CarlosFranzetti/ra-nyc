import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ThemeProvider } from "./context/ThemeContext";
import App from "./App";
import "./index.css";

const DAY_MS = 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep results around long enough to be restored on the next visit;
      // gcTime shorter than maxAge would evict before the persister rehydrates.
      gcTime: DAY_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Persist the query cache to localStorage.
 *
 * This is the single biggest perceived-speed win available: a returning visitor
 * sees the last day they looked at, and any artist they opened, painted from
 * disk on first frame rather than after a network round trip. TanStack still
 * revalidates in the background, so the data is never stale for long.
 *
 * `throttleTime` keeps us from writing to localStorage on every cache mutation —
 * serialising the whole cache is synchronous and would land on the main thread
 * mid-scroll.
 */
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "ra-nyc:query-cache",
  throttleTime: 2_000,
});

createRoot(document.getElementById("root")!).render(
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister,
      maxAge: DAY_MS,
      // Bumping this string invalidates every persisted cache — do it whenever
      // an API response shape changes, or restored data will be the wrong shape.
      buster: "v2-artists",
    }}
  >
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </PersistQueryClientProvider>,
);
