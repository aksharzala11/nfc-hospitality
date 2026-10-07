import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emit .next/standalone so the Docker image can run `node server.js`
  // without shipping the full node_modules tree.
  output: "standalone",
  // The sign-in splash wallpapers (SPLASH_WALLPAPER in src/lib/splash.ts): the login page
  // preloads one and home opens on it as a new document, which can only reuse the cached copy
  // without a network round trip if it is still fresh (public/ files default to max-age=0, so
  // the wallpaper's logo would blink out while it revalidates). A day fresh, then refreshed in
  // the background.
  //
  // The History page's photographs (public/history/photos/, built by
  // scripts/build-history-photos.py): every URL carries the files' content hash (?v=, see
  // historyPhotoSources() in src/lib/history.ts), so a copy can be kept for good. `private`:
  // they sit behind the middleware's session-cookie check (/history/*), so no shared cache may
  // keep one. (The middleware marks its signed-out redirect no-store, so this never sticks to it.)
  // The old address (baps-bky.org, the Dokploy deployment) is retired (user, 2026-10-06): the
  // venue Wi-Fi can't reach it, so the hub lives at naam-five.vercel.app. People still holding
  // the old link land on the same page there (path and query kept). Temporary (307), so no
  // browser keeps it if that changes. Matched by the request's host, so the Vercel deployment
  // never redirects. /api/* is left alone (route handlers, e.g. the display API, answer there as
  // before).
  async redirects() {
    return [
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "(?:www\\.)?baps-bky\\.org" }],
        destination: "https://naam-five.vercel.app/:path",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      ...["/brand/sachu/wallpaper-light.webp", "/brand/sachu/wallpaper-dark.webp"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      })),
      {
        source: "/history/photos/:path*",
        headers: [{ key: "Cache-Control", value: "private, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
