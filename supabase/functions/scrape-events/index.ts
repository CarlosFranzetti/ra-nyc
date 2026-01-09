import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RA_GRAPHQL_URL = 'https://ra.co/graphql';

interface EventListing {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  contentUrl: string;
  images: { filename: string }[];
  venue: {
    name: string;
    area: { name: string };
  };
  artists: { name: string }[];
  attending: number;
  interestedCount: number;
  pick: { blurb: string } | null;
}

async function fetchEventsFromRA(listingDate: string): Promise<EventListing[]> {
  const query = `
    query GET_DEFAULT_EVENTS_LISTING(
      $indices: [IndexType!]
      $pageSize: Int
      $page: Int
      $listingDate: FilterDate
      $filterOptions: FilterOptions
      $sortOrder: SortOrder
    ) {
      listing(
        indices: $indices
        pageSize: $pageSize
        page: $page
        listingDate: $listingDate
        filterOptions: $filterOptions
        sortOrder: $sortOrder
      ) {
        data {
          ... on Event {
            id
            title
            date
            startTime
            endTime
            contentUrl
            images {
              filename
            }
            venue {
              name
              area {
                name
              }
            }
            artists {
              name
            }
            attending
            interestedCount
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
    indices: ["EVENT"],
    pageSize: 50,
    page: 1,
    listingDate: {
      gte: listingDate,
      lte: listingDate,
    },
    filterOptions: {
      areas: { eq: 34 }, // Berlin area code
    },
    sortOrder: "ASCENDING",
  };

  console.log(`Fetching events for date: ${listingDate}`);

  const response = await fetch(RA_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://ra.co/events/de/berlin',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    console.error(`RA API returned status: ${response.status}`);
    throw new Error(`RA API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.errors) {
    console.error('GraphQL errors:', JSON.stringify(data.errors));
    throw new Error('GraphQL query failed');
  }

  console.log(`Found ${data.data?.listing?.data?.length || 0} events`);
  return data.data?.listing?.data || [];
}

function transformEvent(event: EventListing) {
  const imageUrl = event.images?.[0]?.filename 
    ? `https://images.ra.co/${event.images[0].filename}`
    : null;

  return {
    id: event.id,
    title: event.title,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    url: `https://ra.co${event.contentUrl}`,
    imageUrl,
    venue: {
      name: event.venue?.name || 'TBA',
      area: event.venue?.area?.name || 'Berlin',
    },
    artists: event.artists?.map(a => a.name) || [],
    attending: event.attending || 0,
    interested: event.interestedCount || 0,
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

    // Sort by attending count (popularity)
    events.sort((a, b) => b.attending - a.attending);

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
          'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
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
