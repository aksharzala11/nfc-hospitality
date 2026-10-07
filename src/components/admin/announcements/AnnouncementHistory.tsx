"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus, Link2, ListFilter, Loader2, Megaphone, Repeat2, Trash2, Users } from "lucide-react";
import type { NotificationKind } from "@prisma/client";
import { KINDS, linkLabel, listNames, peopleLabel, type AnnouncementView } from "@/lib/admin/announcements";
import { withSevaFilter } from "@/lib/admin/sevaFilter";
import { deleteAnnouncement } from "@/app/admin/announcements/actions";
import { KIND_META } from "./kinds";
import { scopeName, scopeReachLabel, type ScopedAnnouncementView, type SevaScope } from "./sevaScope";
import { Sheet } from "./Sheet";
import {
  BADGE,
  BTN_DESTRUCTIVE,
  BTN_SECONDARY,
  BTN_SMALL_DESTRUCTIVE,
  BTN_SMALL_SECONDARY,
  CHIP,
  CHIP_OFF,
  CHIP_ON,
  chipCount,
} from "./ui";

type Filter = "ALL" | "UPCOMING" | NotificationKind;
const PAGE = 20;
/** Names a personal announcement's row lists before "+N more". */
const NAMES_SHOWN = 6;

/**
 * Every organiser notification, newest first (scheduled ones on top, since
 * their publish time is in the future), including rows from `npm run notify`
 * and automatic schedule-change notices. Reach is recounted with today's accounts.
 * A personal announcement reads "To N people" with their names (this page is
 * admin only) and how many of those accounts still exist.
 *
 * With the console's seva filter on (`scope`), the page sends only the ones
 * that reach someone with those sevas, each saying how many of them it reaches.
 */
export function AnnouncementHistory({
  items,
  total,
  scope = null,
  onSendAgain,
  onToast,
}: {
  items: ScopedAnnouncementView[];
  /** All rows in the table (items may be capped); with a seva filter, all that match it. */
  total: number;
  /** The console's seva filter, or null. */
  scope?: SevaScope | null;
  onSendAgain: (a: AnnouncementView) => void;
  onToast: (text: string) => void;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  const [clearing, startClearing] = useTransition();
  /** "Show all sevas" was pressed: focus the heading once the filter is gone (the button goes with it). */
  const refocusAfterClear = useRef(false);
  // The kind chips and paging belong to one seva filter: router.replace keeps this component
  // mounted, so a new filter (or none) starts again from "All", first page.
  const scopeKey = scope ? scope.labels.join("\n") : "";
  const [listState, setListState] = useState<{ key: string; filter: Filter; limit: number }>({
    key: scopeKey,
    filter: "ALL",
    limit: PAGE,
  });
  const filter: Filter = listState.key === scopeKey ? listState.filter : "ALL";
  const limit = listState.key === scopeKey ? listState.limit : PAGE;
  const [toDelete, setToDelete] = useState<AnnouncementView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const upcoming = items.filter((a) => a.status === "scheduled").length;
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: items.length },
    { key: "UPCOMING", label: "Not sent yet", count: upcoming },
    ...KINDS.map((k) => ({ key: k, label: KIND_META[k].label, count: items.filter((a) => a.kind === k).length })),
  ];
  const filtered = items.filter((a) =>
    filter === "ALL" ? true : filter === "UPCOMING" ? a.status === "scheduled" : a.kind === filter,
  );
  const shown = filtered.slice(0, limit);

  function askDelete(a: AnnouncementView) {
    setDeleteError(null);
    setToDelete(a);
  }

  function confirmDelete() {
    const target = toDelete;
    if (!target || deleting) return;
    startDelete(async () => {
      try {
        const res = await deleteAnnouncement(target.id);
        if (!res.ok) {
          setDeleteError(res.error);
          return;
        }
        setToDelete(null);
        onToast(
          res.alreadyRemoved
            ? "That announcement had already been removed."
            : target.status === "scheduled"
              ? "Scheduled announcement cancelled."
              : "Removed from everyone's notifications.",
        );
      } catch {
        setDeleteError("Couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  const deletingScheduled = toDelete?.status === "scheduled";

  /** "Show all sevas": the same page without the seva params (?now= and the rest stay), no scroll. */
  function clearSevaFilter() {
    const { pathname, search, hash } = window.location;
    refocusAfterClear.current = true;
    startClearing(() => router.replace(withSevaFilter(`${pathname}${search}${hash}`, []), { scroll: false }));
  }

  useEffect(() => {
    if (scope || !refocusAfterClear.current) return;
    refocusAfterClear.current = false;
    headingRef.current?.focus({ preventScroll: true });
  }, [scope]);

  return (
    <section className="mt-8" aria-labelledby={headingId}>
      <div className="mb-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl leading-tight text-ink-900 outline-none"
        >
          History
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">
          {scope ? (
            <>
              Announcements that reach{" "}
              {scope.people === 0
                ? "anyone"
                : scope.people === 1
                  ? "the 1 person"
                  : `any of the ${scope.people.toLocaleString("en-US")} people`}{" "}
              in <span className="font-semibold text-ink-700">{scopeName(scope)}</span>, newest first. Reach counts
              today&apos;s accounts.
            </>
          ) : (
            <>Everything in the bell, newest first. Reach counts today&apos;s accounts.</>
          )}
        </p>
      </div>

      {items.length > 0 && (
        <div role="group" aria-label="Filter history" className="mb-3 flex flex-wrap gap-1.5">
          {filters
            .filter((f) => f.key === "ALL" || f.count > 0 || f.key === filter)
            .map((f) => {
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setListState({ key: scopeKey, filter: f.key, limit: PAGE })}
                  className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} inline-flex items-center`}
                >
                  {f.label}
                  <span className={chipCount(on)}>{f.count}</span>
                </button>
              );
            })}
        </div>
      )}

      {items.length === 0 && scope ? (
        <div className="card px-6 py-10 text-center">
          <span className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
            <ListFilter className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold text-ink-900 [overflow-wrap:anywhere]">
            {scope.people === 0 ? `No one has ${scopeName(scope)} yet` : `Nothing has reached ${scopeName(scope)}`}
          </p>
          <p className="mx-auto mt-0.5 max-w-xs text-xs text-ink-500">
            {scope.people === 0
              ? `Once people with ${scope.labels.length === 1 ? "this seva" : "these sevas"} are added, announcements that reach them show up here.`
              : `No announcement in the bell reaches anyone with ${scope.labels.length === 1 ? "this seva" : "these sevas"}. Announcements for everyone count too.`}
          </p>
          <button
            type="button"
            onClick={clearSevaFilter}
            disabled={clearing}
            aria-busy={clearing || undefined}
            className={`${BTN_SECONDARY} mt-4`}
          >
            {clearing && <Loader2 className="h-4 w-4 animate-spin" />}
            Show all sevas
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <span className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
            <Megaphone className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold text-ink-900">Nothing sent yet</p>
          <p className="mx-auto mt-0.5 max-w-xs text-xs text-ink-500">
            Announcements you send or schedule, and automatic schedule-change notices, show up here.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-ink-600">Nothing here with this filter.</div>
      ) : (
        <ul className="card divide-y divide-ink-800/8 overflow-hidden">
          {shown.map((a) => (
            <HistoryRow
              key={a.id}
              a={a}
              scope={scope}
              onSendAgain={() => onSendAgain(a)}
              onDelete={() => askDelete(a)}
            />
          ))}
        </ul>
      )}

      {filtered.length > shown.length && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setListState({ key: scopeKey, filter, limit: limit + PAGE })}
            className={BTN_SECONDARY}
          >
            Show {Math.min(PAGE, filtered.length - shown.length)} more
          </button>
        </div>
      )}
      {total > items.length && filtered.length <= shown.length && (
        <p className="mt-3 text-center text-[11px] text-ink-500">
          Showing the latest {items.length} of {total}.
        </p>
      )}

      <Sheet
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        busy={deleting}
        title={
          deletingScheduled
            ? "Cancel this scheduled announcement?"
            : "Remove this announcement from everyone's notifications?"
        }
        description={
          toDelete &&
          (deletingScheduled ? (
            <>
              &ldquo;{toDelete.title}&rdquo; won&apos;t be sent.
            </>
          ) : (
            <>
              &ldquo;{toDelete.title}&rdquo; disappears from the bell for everyone who got it. This can&apos;t be undone.
            </>
          ))
        }
        footer={
          <>
            <button type="button" onClick={() => setToDelete(null)} disabled={deleting} className={BTN_SECONDARY}>
              Keep it
            </button>
            <button type="button" onClick={confirmDelete} disabled={deleting} className={BTN_DESTRUCTIVE}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleting ? "Removing…" : deletingScheduled ? "Cancel announcement" : "Remove"}
            </button>
          </>
        }
      >
        {deleteError && (
          <p role="alert" className="rounded-xl bg-ember-500/8 px-3 py-2 text-xs font-medium text-ember-700">
            {deleteError}
          </p>
        )}
      </Sheet>
    </section>
  );
}

function HistoryRow({
  a,
  scope,
  onSendAgain,
  onDelete,
}: {
  a: ScopedAnnouncementView;
  scope: SevaScope | null;
  onSendAgain: () => void;
  onDelete: () => void;
}) {
  const meta = KIND_META[a.kind];
  const Icon = meta.icon;
  const scheduled = a.status === "scheduled";
  const link = linkLabel(a.href);
  // A personal announcement: the accounts it lists (`listed`), of which `people` still exist.
  const personal = a.listed > 0;
  const gone = a.listed - a.people.length;
  const [allNames, setAllNames] = useState(false);
  // Two people of one name carry their BAPS ID (a phone has no hover for the `title`).
  const labels = listNames(a.people);
  const names = allNames ? a.people : a.people.slice(0, NAMES_SHOWN);

  return (
    <li className={`px-4 py-4 sm:px-5 ${scheduled ? "bg-coral-50/70" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.tint}`}>
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1 md:flex md:items-start md:gap-4">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-500">{meta.bellLabel}</span>
              {scheduled && <span className={`${BADGE} bg-coral-100 text-coral-800`}>Scheduled</span>}
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug text-ink-900 [overflow-wrap:anywhere]">{a.title}</p>
            {a.body && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-600 [overflow-wrap:anywhere]">{a.body}</p>
            )}

            {personal ? (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink-600">
                <Users className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p>
                    <span className="font-semibold text-ink-900">To {peopleLabel(a.listed)}</span> · Reaches{" "}
                    {a.reach.toLocaleString("en-US")} of {a.listed.toLocaleString("en-US")}
                  </p>
                  {a.people.length > 0 && (
                    <p className="mt-0.5">
                      {names.map((p, i) => (
                        <span key={p.id} title={`${p.bapsId} · ${p.seva}`}>
                          {i > 0 && ", "}
                          {labels[i]}
                        </span>
                      ))}
                      {a.people.length > NAMES_SHOWN && (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => setAllNames((v) => !v)}
                            aria-expanded={allNames}
                            className="relative rounded font-semibold text-coral-700 transition before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:text-coral-900 focus-visible:outline-2 focus-visible:outline-coral-600"
                          >
                            {allNames ? "Show fewer" : `+${a.people.length - NAMES_SHOWN} more`}
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  {gone > 0 && (
                    <p className="mt-0.5 font-medium text-coral-800">
                      {gone === a.listed
                        ? gone === 1
                          ? "Their account no longer exists."
                          : "Their accounts no longer exist."
                        : `${gone === 1 ? "1 account" : `${gone} accounts`} it was for no longer ${gone === 1 ? "exists" : "exist"}.`}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink-600">
                <Users className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-semibold text-ink-900">{a.audienceLabel}</span> · {peopleLabel(a.reach)}
                </span>
              </p>
            )}
            {scope && a.sevaReach !== undefined && (
              <p className="mt-1.5">
                <span className="inline-flex max-w-full items-start gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold leading-snug text-coral-800 ring-1 ring-inset ring-coral-200">
                  <ListFilter aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-coral-700" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{scopeReachLabel(a.sevaReach, scope)}</span>
                </span>
              </p>
            )}
            {link && (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-600">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                Opens {link}
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-ink-500">
              {scheduled ? (
                <>
                  Scheduled for <span className="font-semibold text-coral-800">{a.whenLabel}</span>
                  {a.relativeLabel && ` (${a.relativeLabel})`}
                </>
              ) : (
                <>Sent {a.whenLabel}</>
              )}
              {" · "}
              {a.mine ? "by you" : `by ${a.sender ?? "System"}`}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 md:mt-0 md:w-36 md:flex-col md:items-stretch">
            <button type="button" onClick={onSendAgain} className={BTN_SMALL_SECONDARY}>
              {scheduled ? <CopyPlus className="h-3.5 w-3.5" /> : <Repeat2 className="h-3.5 w-3.5" />}
              {scheduled ? "Duplicate" : "Send again"}
            </button>
            <button type="button" onClick={onDelete} className={BTN_SMALL_DESTRUCTIVE}>
              <Trash2 className="h-3.5 w-3.5" />
              {scheduled ? "Cancel" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
