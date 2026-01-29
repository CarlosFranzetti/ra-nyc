import raLogo from "@/assets/ra-logo.svg";

interface SplashScreenProps {
  isVisible: boolean;
}

export function SplashScreen({ isVisible }: SplashScreenProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
      <img 
        src={raLogo} 
        alt="RA" 
        className="w-20 h-20 animate-pulse" 
      />
    </div>
  );
}