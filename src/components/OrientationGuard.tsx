import { Smartphone } from "lucide-react";
import { SachuLogo } from "@/components/brand/Sachu";

/**
 * Full-screen prompt shown only on touch devices held in landscape (see the
 * `.rotate-guard` media query). Installed-PWA users never see it because the
 * manifest locks orientation to portrait.
 *
 * Laid out for the short, wide screen it appears on: the full-colour Sāchu lock-up on
 * the sand canvas, a hairline, then the message; a coral-gradient band across the top
 * echoes the brand guide's title bar.
 */
export function OrientationGuard() {
  return (
    <div
      className="rotate-guard fixed inset-0 z-[100] items-center justify-center bg-sand-100 px-8"
      role="dialog"
      aria-label="Please rotate your device"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-coral-400 to-coral-700" />
      <div className="flex items-center gap-6">
        <SachuLogo variant="full" className="w-44 shrink-0" />
        <span aria-hidden="true" className="h-24 w-px shrink-0 bg-ink-800/15" />
        <div className="max-w-[16rem]">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-caps text-coral-800">
            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
            Portrait only
          </p>
          <p className="font-display mt-1.5 text-[1.75rem] leading-tight text-ink-900">Please rotate your phone</p>
          <p className="mt-1.5 text-sm text-ink-600">The Hospitality Hub is designed for portrait.</p>
        </div>
      </div>
    </div>
  );
}
