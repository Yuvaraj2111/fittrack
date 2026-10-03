import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = { title: "FitTrack", description: "Personal fitness and health management" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#18212e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head>
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&display=swap"/>
  </head><body><Providers>{children}</Providers></body></html>;
}
