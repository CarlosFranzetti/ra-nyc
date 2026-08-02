import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import HomePage from "./pages/HomePage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* One route. The artist view is a sheet stacked over the event sheet,
            not a page — tapping a DJ should open the lineup in place rather
            than navigate away from the night you were looking at. */}
        <Route path="*" element={<HomePage />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
