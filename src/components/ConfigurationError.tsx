import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ConfigurationError() {
  const hasSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const hasSupabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (hasSupabaseUrl && hasSupabaseKey) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Configuration Error</AlertTitle>
        <AlertDescription className="mt-2 space-y-2">
          <p>The application is missing required Supabase configuration.</p>
          <div className="mt-4 text-sm">
            <p className="font-semibold">Missing environment variables:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              {!hasSupabaseUrl && <li>VITE_SUPABASE_URL</li>}
              {!hasSupabaseKey && <li>VITE_SUPABASE_PUBLISHABLE_KEY</li>}
            </ul>
          </div>
          <div className="mt-4 p-3 bg-muted rounded-md text-sm">
            <p className="font-semibold mb-2">To fix this in Vercel:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to your Vercel project dashboard</li>
              <li>Navigate to Settings → Environment Variables</li>
              <li>Add the missing variables with values from your Supabase project</li>
              <li>Redeploy your application</li>
            </ol>
          </div>
          <p className="text-xs mt-4 text-muted-foreground">
            Get these values from: <a href="https://app.supabase.com/project/_/settings/api" target="_blank" rel="noopener noreferrer" className="underline">Supabase Dashboard → Settings → API</a>
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
