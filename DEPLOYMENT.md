# Deployment Guide for RA NYC Events Browser

This guide provides step-by-step instructions for deploying the RA NYC Events Browser to different hosting platforms.

## Table of Contents
- [Recommended Platform: Vercel](#vercel-recommended)
- [Alternative: Netlify](#netlify)
- [Alternative: GitHub Pages](#github-pages)
- [Environment Variables](#environment-variables)

---

## Vercel (Recommended)

**Why Vercel?**
- Zero-configuration deployment for Vite applications
- Automatic HTTPS and global CDN
- Seamless GitHub integration with auto-deployments
- Excellent performance and reliability
- Generous free tier for personal projects

### Step-by-Step Deployment to Vercel

#### Method 1: Deploy via Vercel Dashboard (Easiest)

1. **Create a Vercel Account**
   - Go to [vercel.com](https://vercel.com)
   - Sign up with your GitHub account

2. **Import Your Repository**
   - Click "Add New..." → "Project"
   - Import your GitHub repository (`CarlosFranzetti/ra-nyc`)
   - Vercel will automatically detect it's a Vite project

3. **Configure Your Project**
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `dist` (auto-filled)
   - **Install Command**: `npm install` (auto-filled)

4. **Add Environment Variables**
   - Click "Environment Variables"
   - Add the following variables:
     ```
     VITE_SUPABASE_PROJECT_ID=your_project_id
     VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
     VITE_SUPABASE_URL=your_supabase_url
     ```
   - Get these values from your `.env` file

5. **Deploy**
   - Click "Deploy"
   - Wait 1-2 minutes for the build to complete
   - Your app will be live at `https://your-project-name.vercel.app`

#### Method 2: Deploy via Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy from Your Project Directory**
   ```bash
   cd ra-nyc
   vercel
   ```

4. **Follow the Prompts**
   - Set up and deploy: `Y`
   - Which scope: Select your account
   - Link to existing project: `N`
   - Project name: `ra-nyc` (or your preferred name)
   - Directory: `./` (press Enter)
   - Override settings: `N`

5. **Add Environment Variables**
   ```bash
   vercel env add VITE_SUPABASE_PROJECT_ID
   vercel env add VITE_SUPABASE_PUBLISHABLE_KEY
   vercel env add VITE_SUPABASE_URL
   ```

6. **Deploy to Production**
   ```bash
   vercel --prod
   ```

### Automatic Deployments
Once connected to GitHub, Vercel will automatically:
- Deploy every push to the main branch to production
- Create preview deployments for pull requests
- Run the build process and deploy if successful

---

## Netlify

**Why Netlify?**
- Simple deployment process
- Good free tier
- Built-in CI/CD
- Form handling and serverless functions support

### Step-by-Step Deployment to Netlify

#### Method 1: Deploy via Netlify Dashboard

1. **Create a Netlify Account**
   - Go to [netlify.com](https://netlify.com)
   - Sign up with your GitHub account

2. **Import Your Repository**
   - Click "Add new site" → "Import an existing project"
   - Choose "GitHub" and authorize Netlify
   - Select your repository (`CarlosFranzetti/ra-nyc`)

3. **Configure Build Settings**
   - **Branch to deploy**: `main`
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`

4. **Add Environment Variables**
   - Click "Site settings" → "Environment variables"
   - Add the following:
     ```
     VITE_SUPABASE_PROJECT_ID=your_project_id
     VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
     VITE_SUPABASE_URL=your_supabase_url
     ```

5. **Deploy**
   - Click "Deploy site"
   - Wait for the build to complete
   - Your app will be live at `https://your-site-name.netlify.app`

#### Method 2: Deploy via Netlify CLI

1. **Install Netlify CLI**
   ```bash
   npm install -g netlify-cli
   ```

2. **Login to Netlify**
   ```bash
   netlify login
   ```

3. **Initialize Your Site**
   ```bash
   cd ra-nyc
   netlify init
   ```

4. **Follow the Prompts**
   - Create & configure a new site
   - Team: Select your team
   - Site name: Enter a unique name
   - Build command: `npm run build`
   - Directory: `dist`

5. **Deploy**
   ```bash
   netlify deploy --prod
   ```

### Configuration File
The repository includes a `netlify.toml` file with optimized settings for SPA routing and security headers.

---

## GitHub Pages

**Why GitHub Pages?**
- Free for public repositories
- Simple setup
- Good for static sites
- Integrated with GitHub

### Step-by-Step Deployment to GitHub Pages

#### Prerequisites
- Ensure your repository is public (or you have GitHub Pro for private repos)

#### Setup Instructions

1. **Update Vite Configuration (if deploying to a subdirectory)**
   
   If you're deploying to `https://username.github.io/ra-nyc/` (repository pages), you need to set the base path.
   
   Add this to your `vite.config.ts`:
   ```typescript
   export default defineConfig(({ mode }) => ({
     base: '/ra-nyc/', // Change this to match your repo name
     // ... rest of config
   }));
   ```
   
   **Note:** If you're deploying to a custom domain or `username.github.io` (user pages), skip this step.

2. **Enable GitHub Pages in Repository Settings**
   - Go to your repository on GitHub
   - Click "Settings" → "Pages"
   - Under "Source", select "GitHub Actions"

3. **Deploy Using GitHub Actions**
   
   The repository includes a GitHub Actions workflow file (`.github/workflows/deploy.yml`) that automatically:
   - Builds your application
   - Deploys to GitHub Pages
   - Runs on every push to the main branch

4. **Trigger Deployment**
   - Push any commit to the main branch
   - Or manually trigger the workflow from the "Actions" tab

5. **Add Environment Variables to GitHub Secrets**
   - Go to "Settings" → "Secrets and variables" → "Actions"
   - Click "New repository secret"
   - Add the following secrets:
     ```
     VITE_SUPABASE_PROJECT_ID
     VITE_SUPABASE_PUBLISHABLE_KEY
     VITE_SUPABASE_URL
     ```

6. **Access Your Site**
   - Your app will be available at: `https://yourusername.github.io/ra-nyc/`
   - Wait 2-3 minutes after the first deployment

#### Manual Deployment (Alternative)

If you prefer manual deployment:

```bash
# Build the project
npm run build

# Deploy to GitHub Pages using gh-pages package
npm install -g gh-pages
gh-pages -d dist
```

---

## Environment Variables

All deployment platforms require these environment variables:

```env
VITE_SUPABASE_PROJECT_ID=your_project_id_here
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key_here
VITE_SUPABASE_URL=your_supabase_url_here
```

### Getting Your Supabase Credentials

1. Go to your Supabase project dashboard
2. Navigate to "Project Settings" → "API"
3. Copy the following:
   - **Project ID**: Found in the URL or Project Settings
   - **Publishable Key**: The `anon` `public` key
   - **URL**: Your project URL (e.g., `https://xxxxx.supabase.co`)

### Security Note

- Never commit your `.env` file to the repository
- Use the platform's environment variable management
- Rotate keys if accidentally exposed

---

## Comparison of Platforms

| Feature | Vercel ⭐ | Netlify | GitHub Pages |
|---------|---------|---------|--------------|
| **Ease of Setup** | Excellent | Excellent | Good |
| **Build Time** | Fast | Fast | Moderate |
| **Custom Domain** | Free | Free | Free |
| **HTTPS** | Automatic | Automatic | Automatic |
| **Environment Variables** | Yes | Yes | Via GitHub Secrets |
| **Preview Deployments** | Yes | Yes | No |
| **Bandwidth (Free)** | 100GB | 100GB | 100GB |
| **Build Minutes (Free)** | 6000 min/month | 300 min/month | 2000 min/month |
| **Best For** | Modern web apps | General sites | Simple static sites |

## Recommendation

**For this project, we recommend Vercel** because:
- Zero configuration required for Vite
- Fastest deployment times
- Best developer experience
- Excellent performance and reliability
- Most generous free tier for build minutes

However, all three platforms will work well. Choose based on your preference and existing workflow.

---

## Troubleshooting

### Build Fails

1. **Check build logs** for specific errors
2. **Verify environment variables** are set correctly
3. **Ensure Node version** matches your local development (Node 18+ recommended)
4. **Try building locally** with `npm run build` to reproduce the error

### App Doesn't Load

1. **Check browser console** for errors
2. **Verify base path** in `vite.config.ts` (especially for GitHub Pages)
3. **Ensure environment variables** are set in the deployment platform
4. **Check API routes** are correctly configured

### Environment Variables Not Working

1. **Prefix with VITE_** (required for Vite)
2. **Rebuild and redeploy** after adding variables
3. **Check variable names** match exactly
4. **Restart the deployment** after variable changes

---

## Need Help?

- [Vercel Documentation](https://vercel.com/docs)
- [Netlify Documentation](https://docs.netlify.com)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
