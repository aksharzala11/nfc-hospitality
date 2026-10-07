import { Download } from "lucide-react";

/**
 * The organisers' official "Sāchu" phone wallpapers (Digital Assets/Wallpapers), for guests to
 * save. Thumbnails are the light 750 px WebPs; the links download the original 1320x2868 JPEGs
 * (3.9 MB dark, 2.1 MB light), which are only fetched when tapped.
 */
const WALLPAPERS = [
  {
    key: "light",
    label: "Light",
    thumb: "/brand/sachu/wallpaper-light.webp",
    file: "/brand/sachu/wallpapers/naam-2026-sachu-light.jpg",
    size: "2.1 MB",
  },
  {
    key: "dark",
    label: "Dark",
    thumb: "/brand/sachu/wallpaper-dark.webp",
    file: "/brand/sachu/wallpapers/naam-2026-sachu-dark.jpg",
    size: "3.9 MB",
  },
] as const;

export function WallpaperCard({ className = "" }: { className?: string }) {
  return (
    <section className={`card p-4 ${className}`} aria-labelledby="wallpapers-title">
      <p className="text-[10px] font-bold uppercase tracking-caps text-coral-800">Sāchu theme</p>
      <h2 id="wallpapers-title" className="font-display mt-1 text-2xl leading-tight text-ink-900">
        NAAM wallpapers
      </h2>
      <p className="mt-1 text-sm text-ink-600">The official Sāchu theme wallpapers for your phone.</p>
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {WALLPAPERS.map((w) => (
          <li key={w.key}>
            <a
              href={w.file}
              download
              className="group block overflow-hidden rounded-2xl border border-ink-900/10 bg-white shadow-card transition hover:shadow-card-lg active:scale-[0.98] motion-reduce:transition-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={w.thumb}
                width={750}
                height={1630}
                alt={`${w.label} Sāchu wallpaper`}
                loading="lazy"
                decoding="async"
                className="aspect-[9/16] w-full object-cover"
              />
              <span className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-ink-900">
                {w.label}
                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-ink-500">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {w.size}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
