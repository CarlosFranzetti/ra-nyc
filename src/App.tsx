import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import HomePage from "./pages/HomePage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
      {/* Inside BrowserRouter so route changes are tracked as page views once
          there is more than one route. No cookies, so no consent banner. */}
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
