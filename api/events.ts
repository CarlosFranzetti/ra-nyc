import {
  fetchRAEvents,
  isValidDate,
  NYC_AREA_ID,
  RAError,
  type RAEvent,
} from "./_lib/ra.js";

export interface EventsResponse {
  date: string;
  count: number;
  events: RAEvent[];
}

const UPSTREAM_TIMEOUT_MS = 10_000;

function json(body: unknown, status: number, cacheControl?: string): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const areaParam = url.searchParams.get("area");

  if (!date || !isValidDate(date)) {
    return json({ error: "Query param `date` must be YYYY-MM-DD" }, 400);
  }

  const areaId = areaParam ? Number(areaParam) : NYC_AREA_ID;
  if (!Number.isInteger(areaId) || areaId <= 0) {
    return json({ error: "Query param `area` must be a positive integer" }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const events = await fetchRAEvents({
      date,
      areaId,
      signal: controller.signal,
    });

    // Listings barely move within a day, so let the Vercel edge cache absorb
    // the traffic and keep serving stale data while it revalidates.
    return json(
      { date, count: events.length, events } satisfies EventsResponse,
      200,
      "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
    );
  } catch (error) {
    if (error instanceof RAError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return json({ error: "Resident Advisor timed out" }, 504);
    }
    console.error("[api/events] unexpected failure", error);
    return json({ error: "Failed to load events" }, 500);
  } finally {
    clearTimeout(timeout);
  }
}
