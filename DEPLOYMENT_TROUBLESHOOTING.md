# Deployment Troubleshooting Guide

## Issue: App Not Loading on Vercel

If your app at https://ra-nyc.vercel.app/ is not loading or showing a configuration error, it's likely because the required Supabase environment variables are not set in Vercel.

### Root Cause

The application requires these environment variables to connect to Supabase:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

These variables exist in your local `.env` file but need to be manually configured in Vercel.

### Solution: Configure Environment Variables in Vercel

#### Option 1: Via Vercel Dashboard (Recommended)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your `ra-nyc` project
3. Click on **Settings** tab
4. Click on **Environment Variables** in the left sidebar
5. Add each variable:

   **Variable 1:**
   - Name: `VITE_SUPABASE_URL`
   - Value: `https://sjskkjsluxivtovzkajb.supabase.co`
   - Environment: Select all (Production, Preview, Development)

   **Variable 2:**
   - Name: `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqc2pranNsdXhpdnRvdnprYWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MTgwMjMsImV4cCI6MjA4MzQ5NDAyM30.H1rQNScoY_lqBj0fBUQHDokaMND4vJDeIThhBpaZ-HM`
   - Environment: Select all (Production, Preview, Development)

6. Click **Save** for each variable
7. Trigger a new deployment:
   - Go to the **Deployments** tab
   - Click on the three dots menu (⋯) next to the latest deployment
   - Select **Redeploy**
   - Or push a new commit to trigger automatic deployment

#### Option 2: Via Vercel CLI

If you have the Vercel CLI installed:

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Login to Vercel
vercel login

# Link to your project (run in project root)
vercel link

# Add environment variables
vercel env add VITE_SUPABASE_URL
# When prompted, paste: https://sjskkjsluxivtovzkajb.supabase.co
# Select all environments

vercel env add VITE_SUPABASE_PUBLISHABLE_KEY
# When prompted, paste your Supabase publishable key
# Select all environments

# Trigger a new deployment
vercel --prod
```

### Verification

After setting the environment variables and redeploying:

1. Wait for the deployment to complete (usually 1-2 minutes)
2. Visit https://ra-nyc.vercel.app/
3. The app should now load properly
4. If you still see the configuration error, check the browser console for specific error messages

### Checking Environment Variables

To verify environment variables are set in Vercel:

1. Go to your project settings
2. Click **Environment Variables**
3. You should see both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` listed

### Common Issues

#### Variables Set But App Still Showing Error

- **Cause**: Old build is cached
- **Solution**: Force a new deployment
  - Go to Deployments tab → Click "Redeploy" on the latest deployment
  - Or push a new commit to trigger a rebuild

#### Variables Not Available During Build

- **Cause**: Vite requires environment variables to be available at build time
- **Solution**: Make sure variables are set for all environments (Production, Preview, Development)

#### CORS or Network Errors

- **Cause**: Supabase URL might be incorrect or Supabase project might be paused
- **Solution**:
  - Verify the Supabase URL is correct: https://sjskkjsluxivtovzkajb.supabase.co
  - Check your Supabase project status at https://app.supabase.com/

### Security Notes

- The `VITE_SUPABASE_PUBLISHABLE_KEY` is safe to expose in client-side code (it's a public/anonymous key)
- The `VITE_` prefix makes these variables available in the browser
- Never expose your Supabase service role key (private key) in environment variables that start with `VITE_`

### Additional Help

If issues persist:
1. Check browser console for specific errors
2. Check Vercel deployment logs for build errors
3. Verify Supabase Edge Function "scrape-events" is deployed and working
4. Check Supabase project is active (not paused due to inactivity)
