import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RA_GRAPHQL_URL = 'https://ra.co/graphql';

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
    query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int, $sort: FilterSortInput) {
      eventListings(filters: $filters, pageSize: $pageSize, page: $page, sort: $sort) {
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
    sort: {
      attending: { priority: 1, order: "DESCENDING" },
    },
  };

  console.log(`Fetching events for date: ${listingDate}`);

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
    console.error(`RA API returned status: ${response.status}`);
    const text = await response.text();
    console.error(`Response body: ${text}`);
    throw new Error(`RA API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.errors) {
    console.error('GraphQL errors:', JSON.stringify(data.errors));
    throw new Error('GraphQL query failed: ' + data.errors[0]?.message);
  }

  const events = data.data?.eventListings?.data || [];
  console.log(`Found ${events.length} events`);
  return events;
}

function transformEvent(item: EventData) {
  const event = item.event;
  const imageUrl = event.flyerFront 
    ? event.flyerFront.startsWith('http') 
      ? event.flyerFront 
      : `https://images.ra.co/${event.flyerFront}`
    : event.images?.[0]?.filename 
      ? `https://images.ra.co/${event.images[0].filename}`
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    
    // Default to today if no date provided
    const date = dateParam || new Date().toISOString().split('T')[0];
    
    console.log(`Processing request for date: ${date}`);
    
    const rawEvents = await fetchEventsFromRA(date);
    const events = rawEvents.map(transformEvent);

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
    console.error('Error in scrape-events function:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
