# RA NYC Events Browser

A quick and simple browser for browsing Resident Advisor NYC events.

## 🚀 Deployment

Ready to deploy? Check out our comprehensive [**DEPLOYMENT.md**](./DEPLOYMENT.md) guide for step-by-step instructions on deploying to:

- **Vercel** (Recommended) - Zero-config deployment with excellent performance
- **Netlify** - Simple setup with great features
- **GitHub Pages** - Free hosting for public repositories

The deployment guide includes complete instructions, configuration files, and troubleshooting tips for each platform.

## Getting Started

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps to set up and run the project:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd ra-nyc

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and instant preview.
npm run dev
```

## How to Contribute

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use your local IDE**

- Clone the repository to your local machine.
- Make your changes.
- Push your changes back to the repository.

**Use GitHub Codespaces**

- Navigate to the main page of this repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit your changes when done.

## Technologies

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Supabase

## Environment Variables

This project uses Supabase for backend services. You'll need to set up environment variables:

1. Copy `.env.example` to `.env`
2. Fill in your Supabase credentials from your Supabase project dashboard
3. Never commit your `.env` file to version control

For deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md) for instructions on setting environment variables for each platform.
