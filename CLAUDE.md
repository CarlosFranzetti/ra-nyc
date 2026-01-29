# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RA NYC Events Browser - A Vite + React + TypeScript SPA that displays Resident Advisor events for New York City. Data is fetched from RA's GraphQL API via a Supabase Edge Function (Deno), which acts as a proxy to avoid CORS issues and implement rate limiting.

## Development Commands

```bash
# Install dependencies
npm install

# Start dev server (runs on http://[::]:8080)
npm run dev

# Build for production
npm run build

# Build for development (preserves dev env vars)
npm run build:dev

# Lint code
npm run lint

# Preview production build
npm run preview
```

## Architecture Overview

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS with custom theme system
- **Data Fetching**: TanStack Query (React Query) with aggressive prefetching
- **Routing**: React Router v6
- **Backend**: Supabase Edge Functions (Deno runtime)

### Key Architectural Decisions

**1. Data Flow Architecture**
- `useEvents` hook (src/hooks/useEvents.ts) manages all event fetching
- Automatically prefetches adjacent days (+1, +2, -1) for smooth navigation
- 5-minute stale time, 30-minute garbage collection time
- `placeholderData` for instant navigation using cached data

**2. Supabase Edge Function as API Proxy**
- Located in `supabase/functions/scrape-events/index.ts`
- Proxies requests to RA's GraphQL API at `https://ra.co/graphql`
- **CORS handling**: Environment-aware (localhost in dev, Lovable/Supabase domains in prod)
- **Rate limiting**: Upstash Redis if configured, falls back to in-memory Map
- **Security**: Origin validation, input sanitization, error message redaction
- Filters events by NYC area code (area ID: 8)

**3. Dynamic Theming System**
- `ThemeContext` (src/contexts/ThemeContext.tsx) provides 4 theme settings:
  - `colorTheme`: "neon" | "vapor" | "matrix" | "sunset" (randomized on load)
  - `layoutDensity`: "default" | "tight" | "airy"
  - `typography`: "system" | "mono" | "display"
  - `navStyle`: "standard" | "tabs" | "minimal"
- All settings persisted to localStorage except color theme (always randomized)
- Settings applied via CSS classes on `document.documentElement`

**4. Navigation Modes**
- **Standard**: Date picker in header, standard navigation
- **Tabs**: Bottom navigation bar, calendar popup
- **Minimal**: Swipe gestures only, no date picker (for immersive experience)

### File Structure

```
src/
├── components/          # UI components
│   ├── ui/             # shadcn/ui base components (Radix UI)
│   ├── EventCard.tsx   # Main event display card
│   ├── EventDetailsSheet.tsx  # Modal for event details
│   ├── Header.tsx      # Top navigation bar
│   ├── BottomNav.tsx   # Bottom tab bar (tabs mode)
│   └── DatePicker.tsx  # Horizontal date selector
├── contexts/
│   └── ThemeContext.tsx  # Theme settings provider
├── hooks/
│   ├── useEvents.ts    # Primary data fetching hook
│   └── use-toast.ts    # Toast notifications
├── integrations/
│   └── supabase/
│       ├── client.ts   # Supabase client config
│       └── types.ts    # Auto-generated DB types
├── pages/
│   ├── Index.tsx       # Main page (event list)
│   └── NotFound.tsx    # 404 page
├── types/
│   └── event.ts        # Event and EventsResponse interfaces
├── lib/
│   └── utils.ts        # Utility functions (cn helper)
├── App.tsx             # Root component with providers
└── main.tsx            # Entry point
```

### Component Patterns

**Event Data Structure** (src/types/event.ts):
```typescript
interface Event {
  id: string;
  title: string;
  date: string;         // YYYY-MM-DD
  startTime: string;
  endTime: string;
  url: string;          // Full RA URL
  imageUrl: string | null;
  venue: { name: string; area: string };
  artists: string[];
  attending: number;    // Used for sorting
  interested: number;
  isPick: boolean;      // RA editor's pick
  pickBlurb: string | null;
}
```

**Loading States**:
- `isLoading`: Initial load, show 6 `EventSkeleton` components
- `isFetching`: Background refresh, reduce opacity to 60%
- `isError`: Show `ErrorState` with retry button
- Empty: Show `EmptyState` with date

**Animations**:
- `.stagger-animation` class triggers child animations on mount
- `dateKey` state increments on date change to force remount/re-animation
- Splash screen shows on initial load, fades after data arrives

## Environment Variables

Required for deployment:
```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
VITE_SUPABASE_PROJECT_ID=your_project_id
```

**Note**: All Vite env vars must be prefixed with `VITE_` to be exposed to the client.

## Deployment

See DEPLOYMENT.md and QUICK-DEPLOY.md for full instructions. Supported platforms:
- **Vercel** (recommended): Zero-config, auto-detects Vite
- **Netlify**: Uses netlify.toml for SPA routing
- **GitHub Pages**: Requires setting `base` in vite.config.ts to repo name

## Supabase Edge Function Development

To work with the edge function locally:

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase (requires Docker)
supabase start

# Serve functions locally
supabase functions serve --env-file .env.local

# Deploy function
supabase functions deploy scrape-events
```

**Important**: The edge function requires specific CORS configuration. When modifying CORS logic:
- Ensure localhost ports match dev server (8080 by default)
- Production should allow Lovable domains and configured Supabase URL
- Never expose internal API errors to clients (see error handling pattern in index.ts:401-412)

## Code Style Notes

- Uses path alias `@/` for `src/` directory
- shadcn/ui components in `src/components/ui/` should not be modified directly
- Custom components extend shadcn/ui components via composition
- Tailwind utility classes preferred over custom CSS
- Theme-aware components use `useTheme()` hook for settings access
- Date formatting uses `date-fns` library exclusively

## Common Tasks

**Adding a new theme**:
1. Add theme name to `ColorTheme` type in ThemeContext.tsx
2. Add to `colorThemes` array
3. Define CSS variables in src/index.css under new theme class

**Modifying navigation behavior**:
- Check `navStyle` from `useTheme()` context
- Standard/tabs: use DatePicker component
- Minimal: implement swipe gestures (see Index.tsx:50-68)
- Bottom nav only renders when `navStyle === "tabs"`

**Changing event fetch logic**:
- Modify `fetchEvents` in useEvents.ts for client-side changes
- Modify GraphQL query in supabase/functions/scrape-events/index.ts for API changes
- Prefetch strategy controlled in useEffect (useEvents.ts:21-36)

**Working with the RA API**:
- All requests go through Supabase Edge Function (never direct from frontend)
- NYC area code is hardcoded as `8` in the filters
- Events auto-sorted by `attending` count (descending)
- GraphQL schema can be explored at https://ra.co/graphql (use browser dev tools)
