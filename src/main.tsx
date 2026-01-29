import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

console.log('Starting RA NYC Events app...');
console.log('Environment variables:', {
  hasSupabaseUrl: !!import.meta.env.VITE_SUPABASE_URL,
  hasSupabaseKey: !!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  mode: import.meta.env.MODE,
  dev: import.meta.env.DEV,
  prod: import.meta.env.PROD
});

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  console.log('Rendering app...');
  createRoot(rootElement).render(<App />);
  console.log('App rendered successfully');
} catch (error) {
  console.error('Failed to render app:', error);
  const errorDiv = document.getElementById('error-display');
  if (errorDiv) {
    errorDiv.style.display = 'block';
    errorDiv.innerHTML = '<strong>Initialization Error:</strong> ' + (error as Error).message;
  }
}
