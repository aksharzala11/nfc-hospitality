"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ArrowRight, CircleAlert, KeyRound, Loader2, Mail, MessageSquareText, RotateCcw } from "lucide-react";
import { SplashArt } from "@/components/brand/SplashArt";
import { preloadSplashWallpaper } from "@/lib/splash";

type Step = "id" | "code";
// Sign-in emails can take a minute to reach some mailboxes, so Resend waits that long.
const RESEND_SECONDS = 60;
/**
 * If home still hasn't replaced this page by then (a stalled connection, and no browser progress
 * bar in an installed app), drop the splash so "Signing you in…" shows again.
 */
const SPLASH_GIVE_UP_MS = 12_000;
const CODE_SLOTS = [0, 1, 2, 3, 4, 5];

// Sāchu theme: tracked-caps Just Sans labels, sand fields that turn white with a coral ring on
// focus, and the coral gradient for the primary action. Ink-950 text on coral-400→500 keeps
// AA (≥ 5.2:1 across the whole gradient); white would not be legible on the light coral.
// The sand fill is almost the card's white, so the ink-400 outline is what marks the field
// (≥ 3.3:1 on sand-50 and white, WCAG 1.4.11); the OTP boxes use the same outline.
const LABEL = "mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-ink-800";
const FIELD =
  "block w-full rounded-2xl border border-ink-400 bg-sand-50 text-ink-900 transition-colors focus:border-coral-600 focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-coral-400/25 motion-reduce:transition-none";
const PRIMARY =
  "group flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-base font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800 enabled:active:translate-y-px motion-reduce:transition-none motion-reduce:enabled:active:translate-y-0";
const PRIMARY_CORAL =
  "bg-gradient-to-br from-coral-400 to-coral-500 text-ink-950 shadow-glow hover:from-coral-300 hover:to-coral-400";
// While a request is running the button stays coral (it's working, not unavailable).
const PRIMARY_IDLE_DISABLED =
  "disabled:cursor-not-allowed disabled:from-sand-200 disabled:to-sand-200 disabled:text-ink-500 disabled:shadow-none";
// Signed in: the brand's teal gradient (from jade-600 so white text keeps AA).
const PRIMARY_DONE = "bg-gradient-to-br from-jade-600 to-ink-800 text-white shadow-card";

/**
 * `directSignIn`: the EMERGENCY switch is on (src/lib/directSignIn.ts): the first step takes a
 * BAPS ID or an email, and a delegate is signed in by it (no code step); others still get a code.
 * `next`: an NFC tag's /here/<place> (src/lib/here.ts, checked by the page): where signing in
 * goes instead of home (that page sends each role to its own map).
 */
export function LoginForm({
  initialMessage,
  directSignIn = false,
  next = null,
}: {
  initialMessage?: string;
  directSignIn?: boolean;
  next?: string | null;
}) {
  const [step, setStep] = useState<Step>("id");
  const [bapsId, setBapsId] = useState("");
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState("");
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [staticCode, setStaticCode] = useState(false);
  // On the code step without a fresh send: too many codes were requested, and one already sent
  // still works.
  const [sentEarlier, setSentEarlier] = useState(false);
  // Nothing they were sent can sign them in any more (expired, used, or out of tries): only a
  // new code helps, so the screen must not invite them to enter the old ones.
  const [codesSpent, setCodesSpent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialMessage ?? null);
  // The alert on screen is the "try again in about N minutes" one: it goes when that wait is over.
  const errorIsWait = useRef(false);
  // Says a resend went out (announced politely to screen readers).
  const [notice, setNotice] = useState<string | null>(null);
  // When Resend opens again, as a clock time: the countdown is worked out from it, so it stays
  // right while the phone suspends the page (the guest is in their mail app). `limited` = the
  // server's wait after too many codes, which a wrong or expired code must not cut short.
  const [resendWait, setResendWait] = useState<{ until: number; limited: boolean } | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  // The Sāchu wallpaper over the whole login page from a successful verify until home loads.
  const [splash, setSplash] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  // iOS autofill fires the auto-verify from onChange and then submits the form,
  // so the same code can arrive twice. Only one verify may be in flight, and
  // once it succeeds nothing else runs while the page navigates.
  const verifyInFlight = useRef(false);
  const verified = useRef(false);
  const requestInFlight = useRef(false);

  function showError(message: string | null, isWait = false) {
    errorIsWait.current = isWait && message !== null;
    setError(message);
  }

  function startWait(seconds: number, limited: boolean) {
    setResendWait({ until: Date.now() + seconds * 1000, limited });
    setResendIn(seconds);
  }

  function clearWait() {
    setResendWait(null);
    setResendIn(0);
  }

  useEffect(() => {
    if (!resendWait) return;
    const sync = () => {
      const left = Math.ceil((resendWait.until - Date.now()) / 1000);
      if (left > 0) {
        setResendIn(left);
        return;
      }
      setResendWait(null);
      setResendIn(0);
      // The wait is over, so "try again in about N minutes" is out of date.
      if (errorIsWait.current) {
        errorIsWait.current = false;
        setError(null);
      }
    };
    const timer = setInterval(sync, 500);
    // Timers pause while the page is in the background: catch up the moment it is back.
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("focus", sync);
    };
  }, [resendWait]);

  useEffect(() => {
    if (step !== "code") return;
    codeRef.current?.focus();
    // Warm the cache with the sign-in splash's wallpaper (for this colour scheme) while the
    // guest fetches their code, so it's on screen the instant the code is accepted.
    preloadSplashWallpaper();
  }, [step]);

  useEffect(() => {
    if (!splash) return;
    const t = setTimeout(() => setSplash(false), SPLASH_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [splash]);

  async function requestCode() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    showError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bapsId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const limited = res.status === 429;
        showError(data.message ?? "Something went wrong. Please try again.", limited);
        if (limited) {
          // Too many codes requested: Resend counts down the server's wait.
          const wait = Math.ceil(Number(data.retryAfterSeconds));
          if (Number.isFinite(wait) && wait > 0) startWait(wait, true);
          // The server says whether a code sent earlier can still sign them in. (An answer
          // without the field, from an older server, says nothing: leave the panel as it is.)
          const usable = data.codesUsable !== false;
          if (typeof data.codesUsable === "boolean") setCodesSpent(!usable);
          // When one can, go on from the ID step to enter it. When none can, stay here: the
          // message says how long to wait for a new one.
          if (usable && step === "id" && typeof data.destination === "string" && data.destination) {
            setDestination(data.destination);
            setChannel(data.channel === "SMS" ? "SMS" : "EMAIL");
            setStaticCode(false);
            setSentEarlier(true);
            setCode("");
            setStep("code");
          }
          // A refused resend: the codes they have still work, so put them back in the code field.
          if (data.codesUsable === true && step === "code") codeRef.current?.focus();
        }
        return;
      }
      if (data.signedIn) {
        // Signed in without a code (direct sign-in): the same hand-over to home as a verified code.
        enterHome(data.home);
        return;
      }
      const resent = step === "code";
      setDestination(data.destination);
      setChannel(data.channel);
      setStaticCode(Boolean(data.staticCode));
      setSentEarlier(false);
      setCodesSpent(false);
      setCode("");
      setStep("code");
      startWait(RESEND_SECONDS, false);
      if (resent) {
        if (!data.staticCode) setNotice(`New code sent to ${data.destination}.`);
        // Resend is switched off again: put the guest back in the code field.
        codeRef.current?.focus();
      }
    } catch {
      showError("Network error. Please check your connection and try again.");
    } finally {
      requestInFlight.current = false;
      if (!verified.current) setLoading(false);
    }
  }

  /**
   * Signed in: cover the login page with the Sāchu splash, then load home as a new document.
   * Full navigation so the new session cookie is sent with a fresh document request (more
   * reliable than a client-side transition on mobile).
   */
  function enterHome(target: unknown) {
    verified.current = true;
    // Cover the login page with the Sāchu splash before navigating (committed synchronously,
    // so it's painted while home loads); home's layout shows the same wallpaper and blurs it
    // away (<LoginSplash>, cued by the hh_splash cookie the server just set). Dismiss the
    // keyboard first, so it doesn't cover the wallpaper and home's identical splash takes over
    // without a jump.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    flushSync(() => {
      setSigningIn(true);
      setSplash(true);
    });
    // Admins land on /admin, santos on /sant, delegates on /dashboard; a tag's link goes back to its place.
    const home = typeof target === "string" && ["/admin", "/sant", "/dashboard"].includes(target) ? target : "/dashboard";
    window.location.replace(next ?? home);
  }

  async function verifyCode(value = code) {
    if (value.length !== 6) return;
    if (verifyInFlight.current || verified.current) return;
    verifyInFlight.current = true;
    setLoading(true);
    showError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bapsId, code: value }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.message ?? "That code isn't right.");
        if (data.error === "EXPIRED" || data.error === "TOO_MANY_ATTEMPTS" || data.error === "NO_CODE") {
          // Nothing they hold works any more, so a new code is the way on: open Resend now,
          // unless the server's wait after too many codes is still running.
          setCodesSpent(true);
          setNotice(null);
          if (!resendWait?.limited) clearWait();
        }
        // The server couldn't check it (503): the code is still good, so leave it in the boxes.
        if (res.status !== 503) setCode("");
        codeRef.current?.focus();
        return;
      }
      // The 6th digit or autofill verifies with the code field still focused: enterHome() blurs it.
      enterHome(data.home);
      return;
    } catch {
      showError("Network error. Please try again.");
    } finally {
      verifyInFlight.current = false;
      if (!verified.current) setLoading(false);
    }
  }

  if (step === "id") {
    return (
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (bapsId.trim().length >= 3) requestCode();
        }}
      >
        <div>
          <label htmlFor="bapsId" className={LABEL}>
            {directSignIn ? "BAPS ID or email" : "BAPS ID"}
          </label>
          <input
            id="bapsId"
            name="bapsId"
            autoFocus
            autoComplete="username"
            autoCapitalize={directSignIn ? "none" : "characters"}
            spellCheck={false}
            placeholder={directSignIn ? "e.g. BK1001 or bk1001@na.baps.id" : "e.g. BK1001"}
            value={bapsId}
            onChange={(e) => {
              const v = e.target.value.replace(/\s/g, "");
              // An email stays lower case; a BAPS ID is upper case.
              setBapsId(directSignIn && v.includes("@") ? v.toLowerCase() : v.toUpperCase());
            }}
            className={`${FIELD} px-4 py-3.5 text-lg font-semibold tracking-wider placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-500`}
          />
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            {directSignIn
              ? "Enter your BAPS ID or email to sign in. Organisers and Pujya Santos get a one-time code."
              : "We’ll send a one-time code to the email or phone number on file for this ID."}
          </p>
        </div>

        {error && <Alert>{error}</Alert>}

        <button
          type="submit"
          disabled={loading || bapsId.trim().length < 3}
          className={`${PRIMARY} ${PRIMARY_CORAL} ${loading ? "cursor-wait" : PRIMARY_IDLE_DISABLED}`}
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {signingIn ? "Signing you in…" : directSignIn ? "Continue" : "Send code"}
          {!loading && (
            <ArrowRight className="h-4 w-4 transition motion-safe:group-hover:translate-x-0.5 motion-reduce:transition-none" />
          )}
        </button>

        {/* Direct sign-in goes to home from this step: the same splash as after a code. */}
        {splash && createPortal(<SplashArt />, document.body)}
      </form>
    );
  }

  // The first empty slot (or the last one once all six are in) shows the caret.
  const activeSlot = codeFocused && !signingIn ? Math.min(code.length, 5) : -1;
  // "Any of them works" is only said while that can be true.
  const showHint = !staticCode && !codesSpent;
  const resendBlocked = resendIn > 0 || loading;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        verifyCode();
      }}
    >
      <div
        className={`flex items-start gap-3 rounded-2xl p-3.5 text-sm leading-relaxed text-ink-800 ${
          staticCode ? "bg-coral-50 ring-1 ring-coral-200" : "bg-sand-100"
        }`}
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
            staticCode ? "bg-coral-700 text-white" : "bg-ink-800 text-sand-50"
          }`}
        >
          {staticCode ? (
            <KeyRound className="h-4 w-4" />
          ) : channel === "EMAIL" ? (
            <Mail className="h-4 w-4" />
          ) : (
            <MessageSquareText className="h-4 w-4" />
          )}
        </span>
        <p className="pt-[5px]">
          {staticCode ? (
            <>This is a tester account. Enter the 6-digit code you were given.</>
          ) : codesSpent ? (
            <>
              The codes we sent to <span className="font-semibold text-ink-900">{destination}</span> can no longer be
              used.{" "}
              {resendIn > 0 ? "You can ask for a new one below once the wait is over." : "Use Resend code below for a new one."}
            </>
          ) : sentEarlier ? (
            <>
              Enter a 6-digit code we already sent to{" "}
              <span className="font-semibold text-ink-900">{destination}</span>. Each code works for 10 minutes.
            </>
          ) : (
            <>
              We sent a 6-digit code to <span className="font-semibold text-ink-900">{destination}</span>. It expires in 10 minutes.
            </>
          )}
        </p>
      </div>

      <div>
        <label htmlFor="code" className={LABEL}>
          Verification code
        </label>
        {/*
          One real input (so iOS/Android one-time-code autofill, paste and screen readers work as
          before) laid transparently over six display boxes. Its text, caret, selection and any
          autofill tint are hidden; the boxes mirror its value and focus.
        */}
        <div className="relative">
          <input
            ref={codeRef}
            id="code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            aria-describedby={showHint ? "code-hint" : undefined}
            placeholder="••••••"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6) verifyCode(v);
            }}
            onFocus={() => setCodeFocused(true)}
            onBlur={() => setCodeFocused(false)}
            className="absolute inset-0 z-10 h-full w-full cursor-text appearance-none rounded-xl border-0 bg-transparent text-base tracking-[-0.5em] text-transparent caret-transparent outline-hidden [-webkit-text-fill-color:transparent] selection:bg-transparent placeholder:text-transparent autofill:opacity-0 [&:-webkit-autofill]:opacity-0"
          />
          <div aria-hidden="true" className="grid grid-cols-6 gap-2">
            {CODE_SLOTS.map((i) => {
              const digit = code[i];
              const active = i === activeSlot;
              const tone = signingIn
                ? "border-jade-500 bg-jade-50 text-jade-700"
                : active
                  ? "border-coral-600 bg-white text-ink-900 ring-4 ring-coral-400/25"
                  : digit
                    ? "border-ink-400 bg-white text-ink-900"
                    : "border-ink-400 bg-sand-50 text-ink-900";
              return (
                <div
                  key={i}
                  className={`grid h-14 place-items-center rounded-xl border text-[26px] font-bold leading-none tabular-nums transition-colors motion-reduce:transition-none ${tone}`}
                >
                  {digit ??
                    (active ? (
                      <span className="h-7 w-0.5 rounded-full bg-coral-600 motion-safe:animate-pulse" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-ink-400" />
                    ))}
                </div>
              );
            })}
          </div>
        </div>
        {showHint && (
          <p id="code-hint" className="mt-2.5 text-xs leading-relaxed text-ink-500">
            The {channel === "EMAIL" ? "email" : "text"} can take a minute to arrive. If you asked for more than one
            code, any of them works.
          </p>
        )}
        {/* Always in the page so screen readers announce the text when it appears. */}
        <p role="status" className={notice ? "mt-2 text-xs font-medium leading-relaxed text-jade-700" : "sr-only"}>
          {notice}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <button
        type="submit"
        disabled={loading || code.length !== 6}
        className={`${PRIMARY} ${signingIn ? PRIMARY_DONE : PRIMARY_CORAL} ${loading ? "cursor-wait" : PRIMARY_IDLE_DISABLED}`}
      >
        {loading && <Loader2 className="h-5 w-5 animate-spin" />}
        {signingIn ? "Signing you in…" : "Verify & continue"}
      </button>

      {/* Wraps on the narrowest phones (a long countdown) instead of breaking inside a button. */}
      <div className="-mx-2 -my-1 flex flex-wrap items-center justify-between gap-x-1 text-sm">
        <button
          type="button"
          onClick={() => {
            setStep("id");
            showError(null);
            setNotice(null);
            setCodesSpent(false);
            setSentEarlier(false);
            setCode("");
            setCodeFocused(false);
          }}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-2 font-medium text-ink-600 underline-offset-4 hover:text-ink-900 hover:underline focus-visible:outline-2 focus-visible:outline-coral-600"
        >
          Use a different ID
        </button>
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus when pressed. */}
        <button
          type="button"
          aria-disabled={resendBlocked}
          aria-label={resendIn > 0 ? `Resend in ${spokenWait(resendIn)}` : undefined}
          onClick={() => {
            if (!resendBlocked) requestCode();
          }}
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl px-2 font-bold tabular-nums text-coral-800 hover:text-coral-900 focus-visible:outline-2 focus-visible:outline-coral-600 aria-disabled:cursor-not-allowed aria-disabled:font-medium aria-disabled:text-ink-500 aria-disabled:hover:text-ink-500"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {resendIn > 0 ? (
            <span>
              Resend in <Countdown seconds={resendIn} />
            </span>
          ) : (
            "Resend code"
          )}
        </button>
      </div>

      {/* Static (the reveal happens on home). In <body>: the card's entrance animation leaves
          a transform on its ancestors, which would trap a fixed layer inside the card. */}
      {splash && createPortal(<SplashArt />, document.body)}
    </form>
  );
}

/** "45s" up to a minute, "6:52" beyond it (the wait after too many codes). */
function Countdown({ seconds }: { seconds: number }) {
  if (seconds <= 60) return <>{seconds}s</>;
  return (
    <>
      {Math.floor(seconds / 60)}
      {/* The button's tabular figures would give the colon a digit's width ("6 : 52"). */}
      <span className="normal-nums">:</span>
      {String(seconds % 60).padStart(2, "0")}
    </>
  );
}

/** The same wait for screen readers ("6:52" is read out as a time of day). */
function spokenWait(seconds: number) {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds <= 60) return plural(seconds, "second");
  const s = seconds % 60;
  return `${plural(Math.floor(seconds / 60), "minute")}${s ? ` ${plural(s, "second")}` : ""}`;
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-2xl border border-ember-500/25 bg-coral-50 px-4 py-3 text-sm font-medium leading-snug text-ember-700"
    >
      <CircleAlert className="mt-px h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
