import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ConfigurationError } from "@/components/ConfigurationError";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  // Check if required environment variables are set
  const hasSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const hasSupabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const isConfigured = hasSupabaseUrl && hasSupabaseKey;

  console.log('App.tsx - Configuration check:', {
    hasSupabaseUrl: !!hasSupabaseUrl,
    hasSupabaseKey: !!hasSupabaseKey,
    isConfigured,
    supabaseUrlPrefix: hasSupabaseUrl ? hasSupabaseUrl.substring(0, 20) + '...' : 'MISSING'
  });

  if (!isConfigured) {
    console.warn('Missing Supabase configuration, showing ConfigurationError component');
    return <ConfigurationError />;
  }

  console.log('Configuration valid, rendering main app');

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
