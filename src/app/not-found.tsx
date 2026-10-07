import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SachuMark } from "@/components/brand/Sachu";
import { AppScroll } from "@/components/AppScroll";

export const metadata: Metadata = { title: "Page not found" };

/** Branded 404 (Next's built-in one brings its own fonts and colours). */
export default function NotFound() {
  return (
    // The app shell without a header (globals.css), like the other screens: only #app-scroll scrolls.
    <div className="app-shell">
      <AppScroll>
        <main className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
          <SachuMark variant="full" className="h-24" priority />
          <p className="mt-6 text-[11px] font-bold uppercase tracking-caps text-coral-800">Page not found</p>
          <h1 className="font-display mt-2 text-4xl leading-tight text-ink-900">This page isn&apos;t here</h1>
          <p className="mt-3 max-w-xs text-sm text-ink-600">
            The link may be old or mistyped. Head back and pick up where you left off.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-ink-800 px-5 py-3 text-sm font-semibold text-white shadow-card transition hover:bg-ink-900 active:scale-[0.98]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to the Hospitality Hub
          </Link>
        </main>
      </AppScroll>
    </div>
  );
}
