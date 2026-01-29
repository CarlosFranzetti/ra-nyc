# Quick Deployment Reference

Need to deploy quickly? Here's the fastest way for each platform:

## ⚡ Vercel (Recommended - 2 minutes)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click "Add New..." → "Project"
3. Import your `CarlosFranzetti/ra-nyc` repository
4. Add environment variables:
   - `VITE_SUPABASE_PROJECT_ID`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_URL`
5. Click "Deploy"
6. Done! Your site is live at `https://your-project.vercel.app`

**Auto-deploy:** Every push to main branch automatically deploys.

---

## 🚀 Netlify (3 minutes)

1. Go to [netlify.com](https://netlify.com) and sign in with GitHub
2. Click "Add new site" → "Import an existing project"
3. Select your repository
4. Build settings are auto-detected from `netlify.toml`
5. Add environment variables in Site Settings
6. Click "Deploy site"
7. Done! Your site is live at `https://your-site.netlify.app`

---

## 📄 GitHub Pages (5 minutes)

1. Go to your repository Settings → Pages
2. Under "Source", select "GitHub Actions"
3. Go to Settings → Secrets and variables → Actions
4. Add repository secrets:
   - `VITE_SUPABASE_PROJECT_ID`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_URL`
5. Push to main branch or manually trigger workflow in Actions tab
6. Done! Your site is live at `https://yourusername.github.io/ra-nyc/`

---

## 📝 Need More Details?

See the complete [DEPLOYMENT.md](./DEPLOYMENT.md) guide for:
- Detailed step-by-step instructions
- CLI deployment options
- Troubleshooting tips
- Platform comparison
- Custom domain setup

## 🔑 Environment Variables

All platforms require these Supabase credentials:

```
VITE_SUPABASE_PROJECT_ID=your_project_id
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
VITE_SUPABASE_URL=https://your-project-id.supabase.co
```

Get these from: [Supabase Dashboard](https://app.supabase.com) → Your Project → Settings → API
