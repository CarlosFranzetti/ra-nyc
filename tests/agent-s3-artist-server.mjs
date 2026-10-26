/**
 * S3 server-side probe for getArtistLinks. Investigation only.
 * Run with:  npx vite-node tests/agent-s3-artist-server.mjs
 * Stubs global fetch; no network, no database (DATABASE_URL unset).
 */
delete process.env.DATABASE_URL;
process.env.SOUNDCLOUD_CLIENT_ID = "probe-client-id";
delete process.env.SOUNDCLOUD_CLIENT_SECRET;

const { getArtistLinks } = await import("../api/_lib/artistLinks.ts");

const realFetch = globalThis.fetch;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Every upstream hangs until the caller's AbortSignal fires. */
function hang(url, init = {}) {
  return new Promise((_, reject) => {
    const signal = init.signal;
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

async function scenario(label, handler) {
  const calls = [];
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url.split("?")[0].replace(/^https?:\/\//, "").slice(0, 60));
    return handler(url, init);
  };
  const started = Date.now();
  try {
    const result = await getArtistLinks("555", "Test DJ");
    console.log(`${label}: resolved in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      JSON.stringify({ sets: result.sets.length, linkSource: result.linkSource, links: result.links.map((l) => l.label) }));
  } catch (error) {
    console.log(`${label}: REJECTED after ${((Date.now() - started) / 1000).toFixed(1)}s`,
      String(error?.name ?? ""), String(error?.message ?? error).slice(0, 120));
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log(`  upstream calls: ${JSON.stringify(calls)}`);
}

// 1. Everything hangs: what is the wall-clock ceiling?
await scenario("1 all-upstreams-hang", (url, init) => hang(url, init));

// 2. SoundCloud returns a null element in its user list; Mixcloud is healthy.
const healthyMixcloud = (url) => {
  if (url.includes("archive.org")) return json({ response: { docs: [] } });
  if (url.includes("ra.co/graphql")) {
    return json({ data: { artist: { contentUrl: "/dj/testdj", biography: "A bio." } } });
  }
  if (url.includes("api-v2.soundcloud.com/search/users")) return json({ collection: [null] });
  if (url.includes("api.mixcloud.com/search/")) {
    return json({ data: [{ username: "testdj", name: "Test DJ", url: "https://www.mixcloud.com/testdj/" }] });
  }
  if (url.endsWith("/cloudcasts/?limit=50")) {
    return json({
      data: [{ key: "/testdj/mix-1/", name: "Mix 1", url: "https://www.mixcloud.com/testdj/mix-1/",
        audio_length: 4000, play_count: 10, created_time: "2026-01-01T00:00:00Z" }],
    });
  }
  if (url.includes("api.mixcloud.com/testdj/")) return json({ biog: "Mixcloud bio." });
  return json({}, 404);
};
await scenario("2 soundcloud-null-element + mixcloud-healthy", healthyMixcloud);

// 3. Control: SoundCloud returns garbage without nulls (fetchJson swallows it).
await scenario("3 soundcloud-404 + mixcloud-healthy", (url, init) =>
  url.includes("soundcloud.com") ? json({}, 404) : healthyMixcloud(url, init));

// 4. RA returns a non-string biography: does the whole lookup die?
await scenario("4 ra-biography-is-object + everything else healthy", (url, init) =>
  url.includes("ra.co/graphql")
    ? json({ data: { artist: { contentUrl: "/dj/testdj", biography: { text: "x" } } } })
    : healthyMixcloud(url, init));
process.exit(0);
