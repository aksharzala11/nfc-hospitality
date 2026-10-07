import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { APP_TITLE } from "@/lib/branding";
import { OrientationGuard } from "@/components/OrientationGuard";

// NAAM 2026 "Sāchu" theme fonts, self-hosted from the organisers' brand kit
// (built by scripts/build-sachu-assets.py). Enilas (file "Enligas") has one weight.
const enilas = localFont({
  src: "./fonts/Enligas-Regular.woff2",
  variable: "--font-enilas",
  weight: "400",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

const justSans = localFont({
  src: "./fonts/JustSans-Variable.woff2",
  variable: "--font-just-sans",
  weight: "135 900",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: APP_TITLE,
    template: `%s · ${APP_TITLE}`,
  },
  description: "Schedule, menus and breakout sessions for NAAM 2026, Edison NJ.",
  applicationName: APP_TITLE,
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NAAM 2026" },
  manifest: "/manifest.webmanifest",
  // The Sāchu mark on sand, built by scripts/build-sachu-assets.py.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  // Keep phone numbers, emails and addresses as plain text (iOS auto-links them otherwise).
  formatDetection: { telephone: false, email: false, address: false, date: false, url: false },
};

// Fixed-scale UI: no pinch or double-tap zoom on mobile.
export const viewport: Viewport = {
  themeColor: "#f3eee5", // sand-100, the app canvas
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${enilas.variable} ${justSans.variable}`}>
      <body>
        {children}
        <OrientationGuard />
      </body>
    </html>
  );
}
