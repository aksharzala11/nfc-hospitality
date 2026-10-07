"use client";

import { useId } from "react";
import { CalendarClock, Send, type LucideIcon } from "lucide-react";
import { dayKey, formatDayShort, formatRelative, formatTime, parseInEventTz, toEventLocalInput } from "@/lib/time";
import type { Draft } from "./draft";
import { CARD_TITLE, FIELD_ERROR, HINT, HINT_WARN, LABEL, inputClass, tileClass } from "./ui";

export const AT_INPUT_ID = "announcement-at";
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** "Fri, Oct 9 · 12:30 PM" in the event's timezone. */
export function formatWhen(date: Date): string {
  return `${formatDayShort(dayKey(date))} · ${formatTime(date)}`;
}

/** The picked schedule time as an instant, or null when empty/invalid. */
export function scheduledDate(at: string): Date | null {
  if (!LOCAL_DATETIME.test(at)) return null;
  const d = parseInEventTz(at);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Default schedule time: the next quarter hour at least 15 minutes out, as Eastern wall clock. */
function suggestedTime(): string {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setUTCSeconds(0, 0);
  // Eastern is a whole number of hours off UTC, so UTC quarter hours are Eastern ones too.
  d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 15) * 15);
  return toEventLocalInput(d);
}

function Choice({
  on,
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  on: boolean;
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`flex items-start gap-2.5 p-3 ${tileClass(on)}`}>
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
          on ? "bg-ink-900 text-white" : "bg-sand-200 text-ink-600"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[11px] font-medium leading-snug text-ink-500">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Send now, or schedule for an Eastern date and time. The datetime-local value
 * is Eastern wall clock whatever the admin's phone is set to; the server turns
 * it into an instant with parseInEventTz().
 */
export function WhenPicker({
  mode,
  at,
  onChange,
  error,
}: {
  mode: Draft["mode"];
  at: string;
  onChange: (patch: Partial<Draft>) => void;
  error?: string;
}) {
  const headingId = useId();
  // Only rendered after the admin picks "Schedule" (client state), so reading the clock here can't
  // cause a hydration mismatch; the layout's periodic refresh keeps "in 25 min" current.
  const now = new Date();
  const date = mode === "schedule" ? scheduledDate(at) : null;
  const passed = date !== null && date.getTime() <= now.getTime();

  return (
    <section className="card p-4 sm:p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className={CARD_TITLE}>
        When
      </h2>
      <div role="group" aria-labelledby={headingId} className="mt-3 grid grid-cols-2 gap-2">
        <Choice
          on={mode === "now"}
          icon={Send}
          title="Send now"
          hint="Shows in bells right away"
          onClick={() => onChange({ mode: "now" })}
        />
        <Choice
          on={mode === "schedule"}
          icon={CalendarClock}
          title="Schedule"
          hint="Pick a time, Eastern"
          onClick={() => onChange({ mode: "schedule", at: scheduledDate(at) ? at : suggestedTime() })}
        />
      </div>

      {mode === "schedule" && (
        <div className="mt-4">
          <label htmlFor={AT_INPUT_ID} className={LABEL}>
            Date &amp; time (Eastern)
          </label>
          <input
            id={AT_INPUT_ID}
            type="datetime-local"
            value={at}
            min={toEventLocalInput(now)}
            onChange={(e) => onChange({ at: e.target.value })}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${AT_INPUT_ID}-help`}
            // iOS Safari collapses an empty date input and centres its value; keep it input-sized and left-aligned.
            className={`mt-1.5 block min-h-11 [&::-webkit-date-and-time-value]:text-left ${inputClass({ invalid: Boolean(error) })}`}
          />
          <p id={`${AT_INPUT_ID}-help`} className={error ? FIELD_ERROR : passed ? HINT_WARN : HINT}>
            {error ??
              (date
                ? passed
                  ? "That time has already passed. Pick a later one."
                  : `${formatWhen(date)} Eastern · ${formatRelative(now, date)}`
                : "Pick the day and time it should appear.")}
          </p>
        </div>
      )}
    </section>
  );
}
