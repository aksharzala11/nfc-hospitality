"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { CalendarClock, History as HistoryIcon, Loader2, Send, X } from "lucide-react";
import {
  PEOPLE_MAX,
  countReach,
  describeAudience,
  linkLabel,
  listNames,
  peopleLabel,
  type AnnouncementView,
  type FacetGroup,
  type PersonPick,
  type Targeting,
} from "@/lib/admin/announcements";
import {
  lookUpAnnouncementPeople,
  publishAnnouncement,
  type AnnouncementFieldErrors,
} from "@/app/admin/announcements/actions";
import { AnnouncementHistory } from "./AnnouncementHistory";
import { AudienceBuilder } from "./AudienceBuilder";
import { BellPreview } from "./BellPreview";
import {
  EMPTY_DRAFT,
  clearDraft,
  draftFromAnnouncement,
  draftStorageKey,
  hasWords,
  isPristine,
  loadDraft,
  saveDraft,
  type Draft,
} from "./draft";
import { MessageFields, TITLE_INPUT_ID } from "./MessageFields";
import { sameSevas, scopeName, type ScopedAnnouncementView, type SevaScope } from "./sevaScope";
import { Sheet } from "./Sheet";
import { TemplatePicker } from "./TemplatePicker";
import { draftFromTemplate, matchesTemplate, type AnnouncementTemplate } from "./templates";
import { Toast, type ToastMessage } from "./Toast";
import { AT_INPUT_ID, WhenPicker, formatWhen, scheduledDate } from "./WhenPicker";
import { BTN_ACCENT, BTN_DESTRUCTIVE, BTN_PRIMARY, BTN_SECONDARY } from "./ui";

const AUDIENCE_ID = "announcement-audience";

/**
 * A change waiting on a "Replace ...?" question: a filled-in composer ("Send
 * again" or a template), or new audience sevas ("Target these sevas" from the
 * console's seva filter, which keeps the message and the rest of the audience).
 */
type Replacement =
  | {
      type: "draft";
      draft: Draft;
      /** Its title, for the "Replace your unsent draft?" question. */
      title: string;
      /**
       * The specific people picked in the composer stay (a template: it then still
       * goes only to them). False = the draft brings its own audience (Send again).
       */
      keepPeople: boolean;
      /** Shown once it is in the composer. */
      toast: string;
      /** Scroll up to the composer (Send again is tapped in the history below it). */
      scroll: boolean;
    }
  | {
      type: "sevas";
      /** The users.seva values to target. */
      sevas: string[];
      /** The picks they cover, named as the filter names them, e.g. "BM RA, SA". */
      name: string;
      /** Picks nobody holds yet, so nothing of theirs goes in (named the same way), or "". */
      skipped: string;
    };

/** Santos (role SANT) the targeting reaches. */
function countSantos(t: Targeting, groups: readonly FacetGroup[]): number {
  return countReach(t, groups.filter((g) => g.role === "SANT"));
}

/** "Name One, Name Two and Name Three"; past `max` names, "Name One, Name Two, Name Three and 4 more". */
function nameList(names: readonly string[], max = 12): string {
  if (names.length <= 1) return names.join("");
  if (names.length > max) return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The draft's audience fields (what an edit there touches). */
const AUDIENCE_KEYS = ["audience", "roles", "sevas", "regions", "hotels", "people"] as const satisfies readonly (keyof Draft)[];

/**
 * A draft that was for specific people who couldn't be brought back (accounts
 * gone, or the look-up failed), so it now reads as an ordinary audience.
 */
type LostPeople = {
  /** What the audience step says until the admin answers. */
  notice: string;
  /** The account ids the draft listed: kept in storage until then, so a reload asks again. */
  ids: string[];
};

const STILL_RESTORING = "Still looking up the people your draft was for. Try again in a moment.";

/** Client-side checks, mirrored (and enforced) by publishAnnouncement. */
function validate(d: Draft, reach: number): AnnouncementFieldErrors {
  const e: AnnouncementFieldErrors = {};
  if (!d.title.trim()) e.title = "Add a title.";
  if (d.mode === "schedule") {
    const at = scheduledDate(d.at);
    if (!at) e.at = "Pick a date and time.";
    else if (at.getTime() <= Date.now()) e.at = "Pick a time in the future.";
  }
  if (reach === 0) e.audience = "No one matches this audience. Widen it to send.";
  return e;
}

function focusField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function SummaryRow({ label, dark = false, children }: { label: string; dark?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={`shrink-0 ${dark ? "text-white/70" : "text-ink-500"}`}>{label}</dt>
      <dd className={`min-w-0 text-right font-semibold [overflow-wrap:anywhere] ${dark ? "text-white" : "text-ink-900"}`}>
        {children}
      </dd>
    </div>
  );
}

/**
 * Announcements page body: composer (templates, message, audience, when), live
 * bell preview with the send button, confirmation, and the history below.
 * Templates and "Send again" only fill the composer; publishing always goes
 * through review() and the confirmation sheet.
 *
 * With specific people picked in the audience step (draft.people) the
 * announcement goes to exactly them: the counts here come from the picks, not
 * the anonymous facet groups, and the audience filters are sent along but
 * cleared by the server. A draft for specific people never becomes one for
 * a wider audience without the admin deciding so: a template keeps the picked
 * people, "Send again" asks before replacing them, and people a restored draft
 * can't bring back stay held (`lostPeople`, also in storage) behind a notice
 * that blocks "Review & send" until it is answered.
 *
 * The draft lives in state here, so the admin layout's 60 s router.refresh()
 * (which only swaps these props) never wipes it; it is also mirrored to
 * localStorage per admin in case the page is reloaded or closed.
 */
export function AnnouncementsConsole({
  adminId,
  groups,
  history,
  historyTotal,
  santLinks,
  sevaScope = null,
}: {
  adminId: string;
  /** Anonymous role/gender/seva/region counts of every account. */
  groups: FacetGroup[];
  history: ScopedAnnouncementView[];
  historyTotal: number;
  /** Composer links the Pujya Santo view can open. */
  santLinks: string[];
  /** The console's seva filter (null = none): narrows the history and offers "Target these sevas". */
  sevaScope?: SevaScope | null;
}) {
  const storageKey = draftStorageKey(adminId);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<AnnouncementFieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [publishing, startPublish] = useTransition();
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  /** A restored draft listed people (stored as account ids) who are being looked up again. */
  const [restoringPeople, setRestoringPeople] = useState(false);
  /** Counts the look-ups started and called off: only the one still current may put people in the draft. */
  const restoreRun = useRef(0);
  /**
   * Held until the admin changes the audience or accepts it: nothing goes out
   * to a wider audience than the draft had without them seeing the notice
   * first. The ids stay in storage meanwhile (saveDraft()), so a reload or
   * coming back to this tab looks them up again and, failing that, asks again.
   */
  const [lostPeople, setLostPeople] = useState<LostPeople | null>(null);
  const peopleNotice = lostPeople?.notice ?? null;
  /** Bumped when the composer is emptied or refilled: the people search starts over. */
  const [pickerKey, setPickerKey] = useState(0);

  // Restore an unsent draft once, after hydration (the server always renders an empty composer).
  // Nothing is written back to storage (`ready`) until the people it listed have been looked up.
  useEffect(() => {
    const run = ++restoreRun.current;
    let unmounted = false;
    const saved = loadDraft(storageKey);
    if (!saved || (isPristine(saved.draft) && saved.peopleIds.length === 0)) {
      setReady(true);
      return;
    }
    setDraft(saved.draft);
    setRestored(true);
    const ids = saved.peopleIds;
    if (ids.length === 0) {
      setReady(true);
      return;
    }
    setRestoringPeople(true);
    // Ends the look-up in one go, so the first save after it (`ready`) already knows whether the
    // people are back in the draft or held behind the notice: their ids never drop out of storage
    // in between.
    const finish = (found: PersonPick[], lost: string | null) => {
      // Unmounted, or the admin emptied the composer or cleared the people meanwhile.
      if (unmounted || run !== restoreRun.current) return;
      if (lost !== null) setLostPeople({ notice: lost, ids });
      else {
        // Anyone picked while the look-up ran stays, after the restored ones.
        setDraft((d) => ({
          ...d,
          people: [...found, ...d.people.filter((p) => !found.some((f) => f.id === p.id))].slice(0, PEOPLE_MAX),
        }));
        const gone = ids.length - found.length;
        if (gone > 0) {
          setToast({
            id: Date.now(),
            tone: "info",
            text: `${gone === 1 ? "1 person" : `${gone} people`} in your draft no longer ${gone === 1 ? "has" : "have"} an account and ${gone === 1 ? "was" : "were"} left out.`,
          });
        }
      }
      setRestoringPeople(false);
      setReady(true);
    };
    lookUpAnnouncementPeople(ids).then(
      (res) => {
        if (!res.ok) {
          finish([], `${res.error} Your draft was for specific people: pick them again before sending.`);
        } else if (res.people.length === 0) {
          finish(
            [],
            "Your draft was for specific people who no longer have an account. Pick people again, or check this audience, before sending.",
          );
        } else finish(res.people, null);
      },
      () =>
        finish(
          [],
          "Couldn't look up the people your draft was for. Reload to try again, pick them again, or check this audience, before sending.",
        ),
    );
    return () => {
      unmounted = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (ready) saveDraft(storageKey, draft, lostPeople?.ids);
  }, [ready, storageKey, draft, lostPeople]);

  const showToast = useCallback((text: string, tone: ToastMessage["tone"] = "success") => {
    setToast({ id: Date.now(), text, tone });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  /** Calls off a restored draft's people look-up that is still running: its answer adds no one. */
  const cancelRestore = useCallback(() => {
    restoreRun.current++;
    setRestoringPeople(false);
    setReady(true);
  }, []);

  const update = useCallback(
    (patch: Partial<Draft>) => {
      // "Reset to everyone" / "Clear N people" while the draft's people are still being looked
      // up: the admin has decided who it is for, so the look-up must not put them back.
      if (patch.people && patch.people.length === 0) cancelRestore();
      setDraft((d) => ({ ...d, ...patch }));
      setServerErrors({});
      // The admin has set the audience themselves: the "people couldn't be restored" notice is answered.
      if (AUDIENCE_KEYS.some((k) => k in patch)) setLostPeople(null);
    },
    [cancelRestore],
  );

  // Specific people picked: it goes to exactly them, and the audience filters are not used.
  const personal = draft.people.length > 0;
  const targeting: Targeting = {
    kind: draft.kind,
    audience: draft.audience,
    roles: draft.roles,
    sevas: draft.sevas,
    regions: draft.regions,
    hotels: draft.hotels,
    userIds: draft.people.map((p) => p.id),
  };
  const reach = personal ? draft.people.length : countReach(targeting, groups);
  // Santos it reaches (link note), and santos in this audience that a Menu
  // notice leaves out because no role is picked, which makes it about the
  // delegate menu (defaultRoles() in src/lib/admin/announcements.ts). People
  // picked by name get it whatever its category, so none are left out then.
  const santsReached = personal
    ? draft.people.filter((p) => p.role === "SANT").length
    : countSantos(targeting, groups);
  const santsLeftOut = personal ? 0 : countSantos({ ...targeting, kind: "GENERAL" }, groups) - santsReached;
  const clientErrors = validate(draft, reach);
  const errors: AnnouncementFieldErrors = { ...(showErrors ? clientErrors : {}), ...serverErrors };
  const audienceError = peopleNotice ?? errors.audience;
  const errorCount = Object.keys(clientErrors).length + (peopleNotice && !clientErrors.audience ? 1 : 0);
  const at = draft.mode === "schedule" ? scheduledDate(draft.at) : null;
  const whenText = draft.mode === "now" ? "Right away" : at ? formatWhen(at) : "Pick a time";
  const link = linkLabel(draft.href || null);
  // The preview is the row as its recipients get it: when every one of them is a sant,
  // a link the Santo view can't open is dropped for them (santHref()), so it shows none.
  const previewLink =
    personal && santsReached === draft.people.length && draft.href !== "" && !santLinks.includes(draft.href)
      ? null
      : link;
  const title = draft.title.trim();

  function review() {
    if (restoringPeople) return;
    setShowErrors(true);
    setServerErrors({});
    if (clientErrors.title) return focusField(TITLE_INPUT_ID);
    if (clientErrors.audience || peopleNotice) return focusField(AUDIENCE_ID);
    if (clientErrors.at) return focusField(AT_INPUT_ID);
    setConfirmError(null);
    setConfirming(true);
  }

  function resetComposer() {
    cancelRestore();
    setDraft(EMPTY_DRAFT);
    clearDraft(storageKey);
    setShowErrors(false);
    setServerErrors({});
    setRestored(false);
    setLostPeople(null);
    setPickerKey((k) => k + 1);
  }

  function publish() {
    if (publishing) return;
    const input = {
      title: draft.title,
      body: draft.body,
      kind: draft.kind,
      href: draft.href || null,
      audience: draft.audience,
      roles: draft.roles,
      sevas: draft.sevas,
      regions: draft.regions,
      hotels: draft.hotels,
      userIds: draft.people.map((p) => p.id),
      mode: draft.mode,
      at: draft.at,
    };
    setConfirmError(null);
    startPublish(async () => {
      try {
        const res = await publishAnnouncement(input);
        if (!res.ok) {
          const gone = res.gonePeople ?? [];
          if (gone.length > 0) {
            // Some picked accounts are gone and nothing was sent. They come off the list and the
            // confirmation closes: the audience has changed, so it is reviewed again from the composer.
            const left = draft.people.filter((p) => !gone.includes(p.id));
            setDraft((d) => ({ ...d, people: d.people.filter((p) => !gone.includes(p.id)) }));
            setConfirming(false);
            setShowErrors(true);
            if (left.length === 0) {
              // No one is left, so the draft now reads as its filters' audience: held like a
              // restored draft whose people are gone, until the admin answers.
              setLostPeople({
                notice:
                  "The people you picked no longer have an account, so nothing was sent. Pick people again, or check this audience, before sending.",
                ids: gone,
              });
            } else setServerErrors(res.fieldErrors ?? {});
            focusField(AUDIENCE_ID);
            return;
          }
          setConfirmError(res.error ?? "Please fix the highlighted fields and try again.");
          setServerErrors(res.fieldErrors ?? {});
          setShowErrors(true);
          return;
        }
        setConfirming(false);
        resetComposer();
        showToast(
          res.duplicate
            ? res.scheduled
              ? "That's already scheduled, so it wasn't added twice."
              : "That was already sent a moment ago, so it wasn't sent twice."
            : res.scheduled
              ? `Scheduled for ${formatWhen(new Date(res.at))}. It will reach ${peopleLabel(res.reach)}.`
              : `Sent to ${peopleLabel(res.reach)}.`,
        );
      } catch {
        setConfirmError("Couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  function applyReplacement(r: Replacement) {
    if (r.type === "sevas") {
      // Only the audience's sevas change, exactly as picking them by hand would.
      update({ sevas: r.sevas });
      setReplacement(null);
      const skipped = r.skipped ? ` (no one has ${r.skipped} yet)` : "";
      showToast(`Audience set to ${r.name}${skipped}. Check it, then send.`, "info");
      return;
    }
    setReplacement(null);
    setShowErrors(false);
    setServerErrors({});
    setRestored(false);
    setPickerKey((k) => k + 1);
    if (r.keepPeople) {
      // A template: the picked people stay, and so does an unanswered "people couldn't be
      // restored" notice (the draft is still the one that was for them).
      const kept = draft.people.length;
      setDraft((d) => ({ ...r.draft, people: d.people }));
      showToast(
        kept > 0
          ? `${r.toast} It still goes only to the ${peopleLabel(kept)} you picked.`
          : `${r.toast} Check it, then send.`,
        "info",
      );
    } else {
      // "Send again": the composer takes that announcement's own audience.
      cancelRestore();
      setDraft(r.draft);
      setLostPeople(null);
      showToast(r.toast, "info");
    }
    if (r.scroll) composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * Fills the composer, asking first when that would throw away words the admin
   * typed, or take off people they picked (a template keeps them, so it doesn't ask for that).
   */
  function offerReplacement(r: Replacement & { type: "draft" }) {
    if (hasWords(draft) || (!r.keepPeople && draft.people.length > 0)) setReplacement(r);
    else applyReplacement(r);
  }

  function sendAgain(a: AnnouncementView) {
    // The restored draft's people aren't back yet: wait, so the question below asks about them too.
    if (restoringPeople) return showToast(STILL_RESTORING, "info");
    const gone = a.listed - a.people.length;
    // A personal announcement nobody is left of: copied without people it would go to everyone.
    if (a.listed > 0 && a.people.length === 0) {
      showToast(
        a.listed === 1
          ? "The person this went to no longer has an account, so it can't be sent again."
          : "The people this went to no longer have accounts, so it can't be sent again.",
        "info",
      );
      return;
    }
    offerReplacement({
      type: "draft",
      draft: draftFromAnnouncement(a),
      title: a.title,
      keepPeople: false,
      toast:
        gone > 0
          ? `Copied into the composer for the ${peopleLabel(a.people.length)} who still ${a.people.length === 1 ? "has" : "have"} an account. Check it, then send.`
          : "Copied into the composer. Check it, then send.",
      scroll: true,
    });
  }

  /** Only fills the composer: sending still takes "Review & send" and the confirmation. */
  function pickTemplate(t: AnnouncementTemplate) {
    // The restored draft's people aren't back yet: wait, so the template is applied to the draft with them.
    if (restoringPeople) return showToast(STILL_RESTORING, "info");
    if (matchesTemplate(draft, t)) {
      showToast("That template is already in the composer. Check it, then send.", "info");
      return;
    }
    offerReplacement({
      type: "draft",
      draft: draftFromTemplate(t, draft),
      title: t.fields.title,
      // Specific people already picked stay picked (applyReplacement() says so in the toast).
      keepPeople: true,
      toast: `${t.label} template filled in.`,
      scroll: false,
    });
  }

  // "Target these sevas": the filter's sevas that people actually hold (every spelling of a picked team).
  const scopeSevas = sevaScope?.userSevas ?? [];
  const sevasTargeted = scopeSevas.length > 0 && sameSevas(draft.sevas, scopeSevas);

  /** Puts the filtered sevas in the audience, asking first when that would drop sevas the admin picked. */
  function targetScopeSevas() {
    if (!sevaScope || scopeSevas.length === 0) return;
    // Named by the picks someone holds: a team nobody has yet adds nothing to the audience.
    const skipped = sevaScope.labels.filter((l) => !sevaScope.targetLabels.includes(l));
    const r: Replacement = {
      type: "sevas",
      sevas: [...scopeSevas],
      name: scopeName({ labels: sevaScope.targetLabels }),
      skipped: skipped.length > 0 ? scopeName({ labels: skipped }) : "",
    };
    if (sevasTargeted) showToast(`The audience already targets ${r.name}.`, "info");
    // Every seva already picked stays (it only gains spellings or more picks), so there's nothing to ask.
    else if (draft.sevas.every((s) => scopeSevas.includes(s))) applyReplacement(r);
    else setReplacement(r);
  }

  /** Sevas in the audience that "Replace sevas" would take out. */
  const droppedSevas = replacement?.type === "sevas" ? draft.sevas.filter((s) => !replacement.sevas.includes(s)) : [];

  function askDiscard() {
    if (hasWords(draft)) setDiscardOpen(true);
    else resetComposer();
  }

  return (
    <>
      <form
        noValidate
        aria-label="New announcement"
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
        className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-5"
      >
        <div ref={composerRef} className="scroll-mt-4 space-y-4">
          {restored && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-coral-200 bg-coral-50 py-1 pl-3.5 pr-1 text-xs font-medium text-ink-800">
              <HistoryIcon className="h-3.5 w-3.5 shrink-0 text-coral-700" />
              <span className="flex-1">Restored your unsent draft.</span>
              <button
                type="button"
                onClick={askDiscard}
                className="min-h-11 rounded-xl px-2.5 font-semibold text-ember-600 transition hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-coral-600"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setRestored(false)}
                aria-label="Dismiss"
                className="flex h-11 w-11 items-center justify-center rounded-full text-ink-600 transition hover:bg-white/70 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-coral-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <TemplatePicker draft={draft} onPick={pickTemplate} />
          <MessageFields
            draft={draft}
            onChange={update}
            errors={errors}
            santLinks={santLinks}
            santsReached={santsReached}
            santsLeftOut={santsLeftOut}
          />
          <AudienceBuilder
            id={AUDIENCE_ID}
            kind={draft.kind}
            value={draft}
            onChange={update}
            groups={groups}
            error={audienceError}
            restoringPeople={restoringPeople}
            onAcceptAudience={lostPeople ? () => setLostPeople(null) : undefined}
            pickerKey={pickerKey}
            sevaTarget={
              sevaScope && {
                name: scopeName(sevaScope),
                count: sevaScope.labels.length,
                people: sevaScope.people,
                available: scopeSevas.length > 0,
                targeted: sevasTargeted,
                onTarget: targetScopeSevas,
              }
            }
          />
          <WhenPicker mode={draft.mode} at={draft.at} onChange={update} error={errors.at} />
        </div>

        {/* Sticks below the ~63px console header on desktops while the composer scrolls. */}
        <aside aria-label="Preview and send" className="mt-4 space-y-3 lg:sticky lg:top-4 lg:mt-0">
          <BellPreview kind={draft.kind} title={draft.title} body={draft.body} linkLabel={previewLink} />
          {/* The send panel: an ink panel with the coral call to action, as in the brand guide. */}
          <div className="rounded-3xl bg-ink-900 p-4 text-white shadow-card-lg ring-1 ring-inset ring-white/10">
            <dl className="space-y-1.5 text-sm">
              <SummaryRow label="To" dark>
                {reach === 0 ? "No one yet" : peopleLabel(reach)}
              </SummaryRow>
              <SummaryRow label="When" dark>
                {whenText}
              </SummaryRow>
            </dl>
            <button type="submit" disabled={publishing || restoringPeople} className={`${BTN_ACCENT} mt-4 w-full`}>
              {draft.mode === "now" ? <Send className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
              {draft.mode === "now" ? "Review & send" : "Review & schedule"}
            </button>
            {showErrors && errorCount > 0 && (
              <p className="mt-2 text-center text-xs font-semibold text-coral-200">
                Fix the highlighted {errorCount === 1 ? "field" : "fields"} first.
              </p>
            )}
            {!isPristine(draft) && (
              <button
                type="button"
                onClick={askDiscard}
                className="mt-1 min-h-11 w-full rounded-xl text-xs font-semibold text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-coral-300"
              >
                Clear composer
              </button>
            )}
          </div>
        </aside>
      </form>

      <AnnouncementHistory
        items={history}
        total={historyTotal}
        scope={sevaScope}
        onSendAgain={sendAgain}
        onToast={showToast}
      />

      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={publishing}
        title={
          draft.mode === "now" ? (
            <>
              Send &ldquo;{title}&rdquo; to {peopleLabel(reach)} now?
            </>
          ) : (
            <>
              Schedule &ldquo;{title}&rdquo; for {whenText}?
            </>
          )
        }
        description={
          draft.mode === "now"
            ? "It shows up in their notification bell straight away."
            : personal
              ? "It appears at that time (Eastern) in the bell of the people you picked, and of no one else."
              : `It appears in the bell at that time (Eastern) for everyone it reaches then; ${peopleLabel(reach)} today.`
        }
        footer={
          <>
            <button type="button" onClick={() => setConfirming(false)} disabled={publishing} className={BTN_SECONDARY}>
              Keep editing
            </button>
            <button type="button" onClick={publish} disabled={publishing || reach === 0} className={BTN_PRIMARY}>
              {publishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : draft.mode === "now" ? (
                <Send className="h-4 w-4" />
              ) : (
                <CalendarClock className="h-4 w-4" />
              )}
              {publishing
                ? draft.mode === "now"
                  ? "Sending…"
                  : "Scheduling…"
                : draft.mode === "now"
                  ? `Send to ${peopleLabel(reach)}`
                  : "Schedule it"}
            </button>
          </>
        }
      >
        <BellPreview kind={draft.kind} title={draft.title} body={draft.body} linkLabel={previewLink} />
        <dl className="mt-3 space-y-2 rounded-2xl bg-white p-3.5 text-xs ring-1 ring-ink-800/8">
          {personal ? (
            <SummaryRow label="Only to">{nameList(listNames(draft.people))}</SummaryRow>
          ) : (
            <SummaryRow label="Audience">{describeAudience(targeting)}</SummaryRow>
          )}
          <SummaryRow label="Reach">{peopleLabel(reach)}</SummaryRow>
          <SummaryRow label="When">{draft.mode === "now" ? "Now" : `${whenText} Eastern`}</SummaryRow>
        </dl>
        {confirmError && (
          <p role="alert" className="mt-3 rounded-xl bg-ember-500/8 px-3 py-2 text-xs font-medium text-ember-700">
            {confirmError}
          </p>
        )}
      </Sheet>

      <Sheet
        open={replacement !== null}
        onClose={() => setReplacement(null)}
        title={replacement?.type === "sevas" ? "Replace the sevas in your audience?" : "Replace your unsent draft?"}
        description={
          replacement &&
          (replacement.type === "sevas" ? (
            <>
              The audience will target {replacement.sevas.join(", ")}, so {droppedSevas.join(", ")}{" "}
              {droppedSevas.length === 1 ? "comes" : "come"} out. Your message and the rest of the audience stay as
              they are.
            </>
          ) : (
            <>
              The composer will be filled with &ldquo;{replacement.title}&rdquo;
              {replacement.keepPeople && personal ? "." : " and its audience."}
              {hasWords(draft) && " What you've written so far will be lost."}
              {personal &&
                (replacement.keepPeople
                  ? ` The ${peopleLabel(draft.people.length)} you picked ${draft.people.length === 1 ? "stays" : "stay"}: it still goes only to them.`
                  : ` The ${peopleLabel(draft.people.length)} you picked ${draft.people.length === 1 ? "comes" : "come"} off the list.`)}
            </>
          ))
        }
        footer={
          <>
            <button type="button" onClick={() => setReplacement(null)} className={BTN_SECONDARY}>
              {replacement?.type === "sevas" ? "Keep my sevas" : "Keep my draft"}
            </button>
            <button
              type="button"
              onClick={() => replacement && applyReplacement(replacement)}
              className={replacement?.type === "sevas" ? BTN_PRIMARY : BTN_DESTRUCTIVE}
            >
              {replacement?.type === "sevas" ? "Replace sevas" : "Replace it"}
            </button>
          </>
        }
      />

      <Sheet
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard this draft?"
        description="The title, message and audience you've set up will be cleared."
        footer={
          <>
            <button type="button" onClick={() => setDiscardOpen(false)} className={BTN_SECONDARY}>
              Keep it
            </button>
            <button
              type="button"
              onClick={() => {
                setDiscardOpen(false);
                resetComposer();
              }}
              className={BTN_DESTRUCTIVE}
            >
              Discard
            </button>
          </>
        }
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </>
  );
}
