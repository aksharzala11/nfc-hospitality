import type { MetadataRoute } from "next";
import { APP_TITLE } from "@/lib/branding";

/**
 * Web app manifest. When a guest adds the hub to their home screen the app
 * opens standalone and locked to portrait.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_TITLE,
    short_name: "NAAM 2026",
    description: "Schedule, menus and breakout sessions for NAAM 2026, Edison NJ.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    // sand-100, the app canvas (same as the viewport themeColor in src/app/layout.tsx).
    background_color: "#f3eee5",
    theme_color: "#f3eee5",
    // The full-colour Sāchu mark on brand sand, built by scripts/build-sachu-assets.py.
    // The maskable ones are full bleed with the mark inside the central safe zone.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
