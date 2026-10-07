import type { Metadata } from "next";
import { LoginForm } from "@/components/LoginForm";
import { directSignInEnabled } from "@/lib/directSignIn";
import { AppScroll } from "@/components/AppScroll";
import { MandirArt } from "@/components/MandirArt";
import { BapsFooter, SachuLogo } from "@/components/brand/Sachu";
import { APP_TITLE, EVENT_DATES, EVENT_PLACE } from "@/lib/branding";
import { hereNextPath } from "@/lib/here";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  expired: "Your session has ended. Please sign in again.",
};

/**
 * Sign-in, composed like the organisers' Sāchu brand guide: the murti small at the top, the
 * Sāchu lock-up as the hero, then the host mandir, the app title and an ink-capped sign-in card, and the
 * standard BAPS footer on an ink band at the end. The Edison mandir stands on that band as the
 * venue's horizon: its solid ground strip runs straight into the ink.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next: nextParam } = await searchParams;
  const initialMessage = reason ? REASONS[reason] : undefined;
  // An NFC tag's /here/<place> (src/lib/here.ts): signing in returns there. Nothing else.
  const next = hereNextPath(nextParam);

  return (
    // The app shell without a header (globals.css): the page scrolls inside #app-scroll, not the
    // document, as the signed-in views do, so Telegram's in-app browser behaves the same here.
    <div className="app-shell">
      <AppScroll>
        <div className="flex min-h-full flex-col">
          <main className="flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <div className="w-full max-w-sm">
              <div className="stagger">
                <SachuLogo variant="full" priority className="mx-auto w-52" />

                <div className="mt-4 text-center">
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.24em] text-ink-600">
                    BAPS Shri Swaminarayan Mandir
                  </p>
                  <h1 className="font-display text-balance text-[26px] leading-tight text-ink-900">{APP_TITLE}</h1>
                  <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-coral-800">
                    {EVENT_PLACE} · {EVENT_DATES}
                  </p>
                </div>

                <section
                  aria-labelledby="sign-in-heading"
                  className="mt-6 overflow-hidden rounded-3xl bg-white shadow-card-lg ring-1 ring-ink-900/5"
                >
                  {/* Coral display type on an ink panel, as in the guide. */}
                  <div className="bg-ink-800 px-6 pb-5 pt-6">
                    <h2 id="sign-in-heading" className="font-display text-[26px] leading-none text-coral-400">
                      Jay Swāminārāyan
                    </h2>
                    <p className="mt-2.5 text-sm leading-relaxed text-sand-200">
                      {next
                        ? "Sign in with your BAPS ID to see where you are on the venue map."
                        : "Sign in with your BAPS ID to see your schedule, menus and breakout sessions."}
                    </p>
                  </div>
                  {/* The brand's coral gradient as the seam between the panel and the form. */}
                  <div aria-hidden="true" className="h-1 bg-gradient-to-r from-coral-400 to-coral-700" />
                  <div className="p-6">
                    <LoginForm initialMessage={initialMessage} directSignIn={directSignInEnabled()} next={next} />
                  </div>
                </section>
              </div>
            </div>
          </main>

          <footer>
            {/*
              Venue horizon: faint sand at the arch, deepening to the ink of the band below. The
              drawing is capped at max-w-md, so on wider screens its ground strip (the bottom 9.6%,
              from 90.4% down) would stand up as a block on the band; the wrapper paints that same
              strip in ink across the full width, so the ground is one straight horizon at any size.
            */}
            <div className="bg-[linear-gradient(to_bottom,transparent_90.4%,var(--color-ink-800)_90.4%)]">
              <MandirArt
                base="ground"
                className="mx-auto w-full max-w-md bg-gradient-to-b from-sand-300 via-ink-300 via-55% to-ink-800 to-90%"
              />
            </div>
            <div className="-mt-px bg-ink-800 px-3 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-7">
              <BapsFooter className="mx-auto w-full max-w-xl" />
            </div>
          </footer>
        </div>
      </AppScroll>
    </div>
  );
}
