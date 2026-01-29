# Scrape Events Edge Function

This Supabase Edge Function scrapes event data from RA.co's GraphQL API with built-in rate limiting and CORS protection.

## Environment Variables

### Required
None - the function works with sensible defaults.

### Optional

#### Rate Limiting (Recommended for Production)
To enable persistent Redis-based rate limiting across cold starts:

- `UPSTASH_REDIS_REST_URL` - Your Upstash Redis REST URL
- `UPSTASH_REDIS_REST_TOKEN` - Your Upstash Redis REST token

If these are not set, the function falls back to in-memory rate limiting (which resets on cold starts).

To set up Upstash Redis:
1. Create a free account at https://upstash.com/
2. Create a new Redis database
3. Copy the REST URL and REST token
4. Set them as secrets in your Supabase project:
   ```bash
   supabase secrets set UPSTASH_REDIS_REST_URL=your_url_here
   supabase secrets set UPSTASH_REDIS_REST_TOKEN=your_token_here
   ```

#### CORS Configuration
- `ENVIRONMENT` - Set to `production` to disable localhost origins
- `DENO_DEPLOYMENT_ID` - Automatically set by Supabase in production deployments

In production environments, localhost origins are automatically disabled for security.

## Rate Limiting

- **Limit**: 30 requests per minute per IP address
- **Window**: 60 seconds
- **Implementation**: Redis-based (with in-memory fallback)

## CORS Policy

### Allowed Origins (Development)
- `http://localhost:8080`
- `http://localhost:8081`
- `http://localhost:5173`
- Any `*.lovable.app` or `*.lovableproject.com` domain

### Allowed Origins (Production)
- Any `*.lovable.app` or `*.lovableproject.com` domain
- Localhost origins are **disabled** in production

## API Usage

### Request
```http
GET /scrape-events?date=2024-01-21
```

or

```http
POST /scrape-events
Content-Type: application/json

{
  "date": "2024-01-21"
}
```

### Response
```json
{
  "date": "2024-01-21",
  "events": [...],
  "count": 42
}
```

### Error Responses

- `400` - Invalid date format
- `403` - Forbidden origin
- `429` - Rate limit exceeded (retry after 60 seconds)
- `500` - Server error
