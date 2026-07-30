import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import HomePage from "./pages/HomePage";

// Split out: most visits never open an artist, and this route pulls in the
// Mixcloud player and its own layout. Keeps first paint on the listings.
const ArtistPage = lazy(() => import("./pages/ArtistPage"));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background p-4 pt-safe">
      <div className="skeleton-glow h-12 rounded-lg" />
      <div className="skeleton-glow mt-3 h-24 rounded-lg" />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          {/* The artist's name rides in ?name= — RA's id alone isn't enough to
              search Mixcloud, and it lets the header render before the fetch. */}
          <Route path="/artist/:id" element={<ArtistPage />} />
        </Routes>
      </Suspense>
      {/* Inside BrowserRouter so route changes are tracked as page views. */}
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
