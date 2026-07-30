import raLogo from "@/assets/ra-logo.svg";

/**
 * Covers the first paint until the first day's data lands, so the app never
 * shows an empty shell on open.
 */
export function SplashScreen({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
      <img src={raLogo} alt="RA" className="w-20 h-20 animate-pulse" />
    </div>
  );
}
