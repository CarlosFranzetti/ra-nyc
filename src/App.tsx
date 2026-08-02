import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { PlayerProvider } from "./context/PlayerContext";
import HomePage from "./pages/HomePage";

function App() {
  return (
    <BrowserRouter>
      {/* Above the router on purpose: the player owns a body-level host for the
          provider iframe, and nothing short of a full reload should be able to
          interrupt a set that is playing. */}
      <PlayerProvider>
        <Routes>
          {/* One route. The artist view is a sheet stacked over the event sheet,
              not a page — tapping a DJ should open the lineup in place rather
              than navigate away from the night you were looking at. */}
          <Route path="*" element={<HomePage />} />
        </Routes>
      </PlayerProvider>
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
