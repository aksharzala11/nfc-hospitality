import Link from "next/link";
import { Check, ChevronRight, Clock, MapPin } from "lucide-react";
import type { BlockStatus, SantBlockView, SantRoomView } from "@/lib/santBreakouts";
import { SantBlockToggle } from "./SantBlockToggle";

/**
 * The breakout blocks of /sant/breakouts (server-rendered; the open / closed state is the
 * SantBlockToggle island's): one card per block in time order, its header the toggle (kicker
 * "Breakout block", the block's name in Enilas, the date and time span, how many sessions, a
 * Now / Up next / Done chip), and under it the block's sessions: title, its own times when they
 * differ from the block's, a "Santo joining" chip on a session the organisers mark so (its times
 * are then the marked part), the note, and its rooms, each a link to /sant/map when it is on the
 * map (else plain text, "not on the map yet" when there is a map it isn't on). The block on now
 * glows in the view's bhagwa; finished ones sit back on a flat sand surface with quiet icons
 * (the text keeps its colours, so it still clears WCAG AA). Inside a block still on, a session
 * already over is quieter too (ink time, sand room chips) and marked Done, so a sant picking
 * where to go sees at once which rooms are still in session.
 */
export function SantBreakoutBlocks({ blocks, openId }: { blocks: SantBlockView[]; openId: string | null }) {
  return (
    <ol className="space-y-4">
      {blocks.map((b) => (
        <li key={b.id}>
          <Block block={b} defaultOpen={b.id === openId} />
        </li>
      ))}
    </ol>
  );
}

// `.card` (globals.css) is unlayered, so it beats plain utilities: the overrides need Tailwind's `!`.
const CARD: Record<BlockStatus, string> = {
  now: "card border-coral-600/50! shadow-glow! ring-1 ring-coral-600/40",
  next: "card",
  upcoming: "card",
  past: "card border-sand-200/80! bg-sand-50/60! shadow-none!",
};

function Block({ block: b, defaultOpen }: { block: SantBlockView; defaultOpen: boolean }) {
  const past = b.status === "past";
  const panelId = `${b.id}-sessions`;
  return (
    <SantBlockToggle
      panelId={panelId}
      defaultOpen={defaultOpen}
      className={CARD[b.status]}
      buttonClassName="hover:bg-sand-50/70"
      chevronClassName={past ? "bg-sand-100 text-ink-500" : "bg-coral-50 text-ember-600"}
      header={
        <>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[11px] font-bold uppercase tracking-caps ${past ? "text-ink-500" : "text-ember-600"}`}>
              Breakout block
            </span>
            <StatusChip status={b.status} />
          </span>
          <span className={`mt-1 block font-display text-[1.6rem] leading-tight ${past ? "text-ink-700" : "text-ink-900"}`}>
            {b.label}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-600">
            <Clock aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${past ? "text-ink-400" : "text-ember-600"}`} />
            <span>{b.dateLabel}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={b.startsAt} className="font-semibold tabular-nums text-ink-700">
              {b.timeLabel}
            </time>
          </span>
          <span className="mt-0.5 block text-sm font-semibold text-ink-700">
            {b.count} {b.count === 1 ? "session" : "sessions"}
          </span>
        </>
      }
    >
      <ul className="mx-4 divide-y divide-sand-200 border-t border-sand-200 pb-1">
        {b.sessions.map((s) => {
          // A session already over in a block still on: quieter, marked Done (a past block says so itself).
          const over = s.over && !past;
          const quiet = past || over;
          return (
            <li key={s.id} className="py-3.5">
              {(s.timeLabel || over || s.santoJoining) && (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {s.timeLabel && (
                    <time
                      dateTime={s.startsAt}
                      className={`block text-xs font-bold tabular-nums ${quiet ? "text-ink-500" : "text-ember-600"}`}
                    >
                      {s.timeLabel}
                    </time>
                  )}
                  {s.santoJoining && <SantoJoiningChip quiet={quiet} />}
                  {over && <DoneChip />}
                </span>
              )}
              <h3 className={`font-display text-[1.25rem] leading-tight ${quiet ? "text-ink-700" : "text-ink-900"}`}>
                {s.title}
              </h3>
              <ul aria-label={s.rooms.length > 1 ? "Rooms" : "Room"} className="mt-2 flex flex-wrap gap-2">
                {s.rooms.map((r, i) => (
                  <li key={`${i}-${r.name}`} className="min-w-0 max-w-full">
                    <Room room={r} past={past} over={over} />
                  </li>
                ))}
              </ul>
              {s.note && <p className="mt-2 text-sm leading-snug text-ink-600">{s.note}</p>}
            </li>
          );
        })}
      </ul>
    </SantBlockToggle>
  );
}

/** "Now" (deep coral, as StatusBadge), "Up next" (ink outline), "Done" (quiet, with a check); none for later blocks. */
function StatusChip({ status }: { status: BlockStatus }) {
  if (status === "now") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-700 px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-white shadow-glow">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse-soft" />
        Now
      </span>
    );
  }
  if (status === "next") {
    return (
      <span className="inline-flex items-center rounded-full border border-ink-800/25 bg-sand-50 px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-ink-800">
        Up next
      </span>
    );
  }
  if (status === "past") return <DoneChip />;
  return null;
}

/**
 * "Santo joining": the organisers mark this session as one the santos join (its times are then
 * the marked part of it). The view's bhagwa: ember-700 on coral-100 (well past AA); on a
 * finished session it steps back to the Done chip's sand (ink-600 on sand-100, AA).
 */
function SantoJoiningChip({ quiet }: { quiet: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps ${
        quiet ? "bg-sand-100 text-ink-600" : "bg-coral-100 text-ember-700"
      }`}
    >
      Santo joining
    </span>
  );
}

/** Quiet "Done" with a check: a finished block, or a finished session in a block still on. */
function DoneChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-ink-600">
      <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.6} />
      Done
    </span>
  );
}

/**
 * A session's room: a 44px chip that opens it on /sant/map, or plain text (with "Not on the map
 * yet" when the map hasn't got it, as /map says of such a name). A session already over in a
 * block still on (`over`) keeps its link on a quiet sand chip, so the ones still to come stand out.
 */
function Room({ room, past, over }: { room: SantRoomView; past: boolean; over: boolean }) {
  if (room.href) {
    return (
      <Link
        href={room.href}
        className={`flex min-h-11 max-w-full items-center gap-1.5 rounded-2xl py-1.5 pl-2.5 pr-2 text-sm font-semibold ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-coral-700 ${
          over
            ? "bg-sand-100 text-ink-700 ring-sand-200 hover:bg-sand-200/70"
            : "bg-coral-50 text-ink-900 ring-coral-200 hover:bg-coral-100"
        }`}
      >
        <MapPin aria-hidden="true" className={`h-4 w-4 shrink-0 ${past || over ? "text-ink-400" : "text-ember-600"}`} />
        <span
          className={`min-w-0 break-words underline decoration-2 underline-offset-2 ${over ? "decoration-ink-300" : "decoration-coral-400"}`}
        >
          {room.name}
        </span>
        <span className="sr-only"> (open on the venue map)</span>
        <ChevronRight
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 ${over ? "text-ink-400" : "text-ember-600"}`}
          strokeWidth={2.4}
        />
      </Link>
    );
  }
  return (
    <span className="flex max-w-full items-start gap-1.5 rounded-2xl bg-sand-100 px-2.5 py-2 text-sm font-semibold text-ink-700">
      <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
      <span className="min-w-0 break-words">
        {room.name}
        {room.offMap && <span className="block text-xs font-medium text-ink-500">Not on the map yet</span>}
      </span>
    </span>
  );
}
