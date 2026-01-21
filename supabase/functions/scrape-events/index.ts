import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Environment check
const IS_PRODUCTION = Deno.env.get('ENVIRONMENT') === 'production' || 
                       Deno.env.get('DENO_DEPLOYMENT_ID') !== undefined;

// Allowed origins for CORS - restrict to your domains
const LOCALHOST_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:5173',
];

const ALLOWED_ORIGINS = IS_PRODUCTION 
  ? [] // No localhost in production
  : LOCALHOST_ORIGINS;

// Check if origin is from a Lovable preview/staging domain
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  
  // Allow exact matches
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  
  // Allow Lovable preview/staging domains
  if (origin.endsWith('.lovable.app') || origin.endsWith('.lovableproject.com')) return true;
  
  return false;
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = isAllowedOrigin(origin) 
    ? origin! 
    : (ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS[0] : 'https://sjskkjsluxivtovzkajb.supabase.co');
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

const RA_GRAPHQL_URL = 'https://ra.co/graphql';

// Rate limiting configuration
const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per IP

// Upstash Redis configuration (optional - falls back to in-memory if not configured)
const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

// In-memory fallback for rate limiting (when Redis is not configured)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Redis-based rate limiting using Upstash REST API
async function checkRateLimitRedis(ip: string): Promise<boolean> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    // Fallback to in-memory rate limiting
    return checkRateLimitInMemory(ip);
  }

  try {
    const key = `ratelimit:${ip}`;
    
    // Use Redis INCR with EXPIRE for atomic rate limiting
    const pipeline = [
      ['INCR', key],
      ['EXPIRE', key, RATE_LIMIT_WINDOW_SECONDS]
    ];

    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
    });

    if (!response.ok) {
      console.error('[RATE_LIMIT] Redis request failed, falling back to in-memory');
      return checkRateLimitInMemory(ip);
    }

    const results = await response.json();
    const count = results[0]?.result;

    if (typeof count === 'number' && count > RATE_LIMIT_MAX_REQUESTS) {
      console.warn(`[RATE_LIMIT] IP ${ip} exceeded rate limit (${count}/${RATE_LIMIT_MAX_REQUESTS})`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[RATE_LIMIT] Redis error, falling back to in-memory:', error);
    return checkRateLimitInMemory(ip);
  }
}

// In-memory rate limiting fallback
function checkRateLimitInMemory(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return false;
  }
  
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  
  record.count++;
  return false;
}

// Validate date format and range
function validateDate(dateStr: string): string | null {
  // Check format YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return null;
  }
  
  // Parse and validate it's a real date
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return null;
  }
  
  // Validate reasonable range (within 1 year past/future)
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const oneYearAhead = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  
  if (date < oneYearAgo || date > oneYearAhead) {
    return null;
  }
  
  return dateStr;
}

interface EventData {
  id: string;
  listingDate: string;
  event: {
    id: string;
    title: string;
    attending: number;
    date: string;
    startTime: string;
    endTime: string;
    contentUrl: string;
    flyerFront: string | null;
    images: { id: string; filename: string; alt: string }[];
    venue: {
      id: string;
      name: string;
      contentUrl: string;
    } | null;
    artists: { id: string; name: string }[];
    pick: { blurb: string } | null;
  };
}

async function fetchEventsFromRA(listingDate: string): Promise<EventData[]> {
  const query = `
    query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
      eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
        data {
          id
          listingDate
          event {
            id
            title
            attending
            date
            startTime
            endTime
            contentUrl
            flyerFront
            images {
              id
              filename
              alt
            }
            venue {
              id
              name
              contentUrl
            }
            artists {
              id
              name
            }
            pick {
              blurb
            }
          }
        }
        totalResults
      }
    }
  `;

  const variables = {
    filters: {
      areas: { eq: 8 }, // NYC area code
      listingDate: {
        gte: listingDate,
        lte: listingDate,
      },
    },
    pageSize: 50,
    page: 1,
  };

  console.log(`[INFO] Fetching events for date: ${listingDate}`);

  const response = await fetch(RA_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://ra.co/events/us/newyork',
      'Origin': 'https://ra.co',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    // Log internally but don't expose to client
    console.error(`[INTERNAL] API returned status: ${response.status}`);
    const text = await response.text();
    console.error(`[INTERNAL] Response body: ${text}`);
    throw new Error('UPSTREAM_ERROR');
  }

  const data = await response.json();
  
  if (data.errors) {
    // Log internally but don't expose to client
    console.error('[INTERNAL] GraphQL errors:', JSON.stringify(data.errors));
    throw new Error('QUERY_ERROR');
  }

  const events = data.data?.eventListings?.data || [];
  console.log(`[INFO] Found ${events.length} events`);
  return events;
}

function transformEvent(item: EventData) {
  const event = item.event;

  const normalizeImage = (src: string) => {
    const s = src.trim();
    if (s.startsWith('http')) return s;
    if (s.startsWith('//')) return `https:${s}`;
    if (s.includes('images.ra.co/')) return `https://${s.replace(/^https?:\/\//, '').replace(/^\/+/, '')}`;
    return `https://images.ra.co/${s.replace(/^\/+/, '')}`;
  };

  const imageUrl = event.flyerFront
    ? normalizeImage(event.flyerFront)
    : event.images?.[0]?.filename
      ? normalizeImage(event.images[0].filename)
      : null;

  return {
    id: event.id,
    title: event.title,
    date: event.date,
    startTime: event.startTime || '',
    endTime: event.endTime || '',
    url: `https://ra.co${event.contentUrl}`,
    imageUrl,
    venue: {
      name: event.venue?.name || 'TBA',
      area: 'New York',
    },
    artists: event.artists?.map(a => a.name) || [],
    attending: event.attending || 0,
    interested: 0,
    isPick: !!event.pick,
    pickBlurb: event.pick?.blurb || null,
  };
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify request is from an allowed origin (CORS already restricts this, but double-check)
    if (!isAllowedOrigin(origin)) {
      console.warn(`[CORS] Rejected request from disallowed origin: ${origin}`);
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Rate limiting by IP
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('cf-connecting-ip') || 
                     'unknown';
    
    if (await checkRateLimitRedis(clientIP)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { 
          status: 429, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' } 
        }
      );
    }

    const url = new URL(req.url);

    // Get date from query params or body
    let rawDate = url.searchParams.get('date') || new Date().toISOString().split('T')[0];

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body === 'object' && 'date' in body && typeof (body as any).date === 'string') {
        rawDate = (body as any).date;
      }
    }

    // Validate date format and range
    const date = validateDate(rawDate);
    if (!date) {
      return new Response(
        JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD within one year of today.' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[INFO] Processing request for date: ${date}, IP: ${clientIP}`);

    const rawEvents = await fetchEventsFromRA(date);
    const events = rawEvents.map(transformEvent).sort((a, b) => b.attending - a.attending);

    return new Response(
      JSON.stringify({ 
        date, 
        events, 
        count: events.length 
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        } 
      }
    );
  } catch (error) {
    // Log detailed error internally
    console.error('[INTERNAL] Error in scrape-events function:', error instanceof Error ? error.stack : error);
    
    // Return generic error to client
    return new Response(
      JSON.stringify({ error: 'Unable to fetch events. Please try again later.' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
