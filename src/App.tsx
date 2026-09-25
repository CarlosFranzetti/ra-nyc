import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { PlayerProvider } from "./context/PlayerContext";
import { useViewportVars } from "./hooks/useViewportVars";
import HomePage from "./pages/HomePage";

function App() {
  // Publishes --vvh and --kb for anything that has to sit above the software
  // keyboard. Once, at the root: it is a fact about the window, not about a
  // component.
  useViewportVars();

  return (
    <BrowserRouter>
      {/* Above the router on purpose: the player owns a body-level host for the
          provider iframe, and nothing short of a full reload should be able to
          interrupt a set that is playing. */}
      <PlayerProvider>
        {/* `vaul-drawer-wrapper` is what makes a sheet feel like iOS rather than
            like a panel sliding over a web page.

            On iOS, presenting a sheet does not just cover the screen underneath
            — the screen underneath *recedes*. It scales back a couple of
            percent, its corners round off, and it darkens, so the two surfaces
            read as a stack with depth rather than as one rectangle occluding
            another. It is the single most recognisable thing about the
            interaction, and it was the one part of it this app did not have:
            the sheets used the right curve and the right duration over a page
            that sat perfectly still.

            vaul implements it against this attribute, so it costs a wrapper and
            a prop. The transform is on one element and is composited, so it is
            free at scroll time — nothing here runs during a scroll.

            The background must be opaque: the page is scaled *down*, which
            exposes a few pixels of whatever is behind it at every edge. Without
            a fill you see through to the document and the effect reads as a
            rendering fault rather than as depth.

            `bg-background` and nothing else — deliberately no `min-h-screen`.
            HomePage's own root already carries it along with the bottom padding
            that clears the transport, and adding a second one here made this
            div the *first* `.min-h-screen` in the document. Nothing visible
            changed; what broke was the player suite, which finds the page by
            that class and started measuring a wrapper with no padding. Two
            elements answering to one name is a real ambiguity even when it is
            only a test that trips over it. */}
        <div vaul-drawer-wrapper="" className="bg-background">
          <Routes>
            {/* One route. The artist view is a sheet stacked over the event
                sheet, not a page — tapping a DJ should open the lineup in place
                rather than navigate away from the night you were looking at. */}
            <Route path="*" element={<HomePage />} />
          </Routes>
        </div>
      </PlayerProvider>
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
