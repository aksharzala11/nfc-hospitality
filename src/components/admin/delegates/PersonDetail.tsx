"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import type { DirectoryPerson } from "@/lib/admin/delegates";
import type { OpenBounceNote } from "@/lib/admin/emailEvents";
import {
  formatPhone,
  formatStamp,
  hasRegistration,
  isTester,
  mirrorStatus,
  sevaIsTeam,
  timeAgo,
  trackLabel,
  trackMismatch,
  type MirrorStatus,
} from "./directory";
import { SheetBody, SheetFooter } from "./Sheet";
import { BADGE, BTN_PRIMARY, LABEL, MirrorChip, RoleBadge } from "./ui";

type Row = { label: string; value: ReactNode; note?: ReactNode; warn?: boolean };

const NOT_SET = <span className="text-ink-500">Not on file</span>;

const muted = (text: string) => <span className="text-ink-500">{text}</span>;

/** Case- and spacing-insensitive form of a label, for spotting repeats. */
const tidyKey = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Where sign-in codes actually go, mirroring requestOtp() in src/lib/otp. */
function signInRow(p: DirectoryPerson): Row {
  if (isTester(p)) {
    return {
      label: "Sign-in codes",
      value: "Fixed tester code",
      note: "No email or SMS is sent. Tester codes can't be seen or changed here.",
    };
  }
  const wanted = p.preferredChannel;
  const has = { EMAIL: Boolean(p.email), SMS: Boolean(p.phone) };
  const row: Row = { label: "Sign-in codes", value: wanted === "SMS" ? "By SMS" : "By email" };
  if (!has.EMAIL && !has.SMS) {
    return { ...row, note: "No email or phone on file, so they can't get a sign-in code yet.", warn: true };
  }
  if (!has[wanted]) {
    const note = wanted === "EMAIL" ? "No email on file, so codes go by SMS." : "No phone on file, so codes go by email.";
    return { ...row, note, warn: true };
  }
  if (p.hasTestCode) return { ...row, note: "Has a tester code, which admin accounts can't use." };
  return row;
}

/**
 * Their email, with an "Email bounced" note while SES has an open bounce for
 * that address (/admin/bounces). After a hard bounce SES sends nothing more to
 * it: correcting the email here gets codes going again (a new address isn't
 * suppressed).
 */
function emailRow(p: DirectoryPerson, bounce: OpenBounceNote | undefined): Row {
  if (!p.email) return { label: "Email", value: NOT_SET };
  if (!bounce) return { label: "Email", value: p.email };
  return {
    label: "Email",
    value: p.email,
    warn: true,
    note: (
      <>
        Email bounced ({bounce.label.toLowerCase()}, last {bounce.lastAt}).{" "}
        {bounce.hard
          ? "SES won't send codes to this address any more: correct it here if it's wrong. "
          : "Codes may not reach them. "}
        <Link href="/admin/bounces" className="underline underline-offset-2 hover:text-coral-900">
          See Email bounces
        </Link>
      </>
    ),
  };
}

/**
 * Linked sessions, or what their breakout page falls back to (see getBreakoutsForUser()). Santos
 * have no sessions of their own: /sant/breakouts offers them every Bhaio session that isn't
 * combined with Behno, plus the combined ones the organisers mark "Santo joining"
 * (src/lib/santBreakouts.ts), whatever breakout_sessions holds.
 */
function breakoutsRow(p: DirectoryPerson): Row {
  if (p.role === "SANT") {
    return {
      label: "Breakouts",
      value: "Any Bhaio session",
      note: "Santos have no sessions of their own: their breakout page lists the Bhaio sessions they can join, with the ones both tracks hold that the organisers mark \"Santo joining\".",
    };
  }
  if (p.breakoutCount > 0) return { label: "Breakouts", value: `${p.breakoutCount} linked` };
  if (!sevaIsTeam(p.seva)) {
    return {
      label: "Breakouts",
      value: "Not linked",
      note: `“${p.seva}” isn't a breakout matrix team, so only sessions added for that exact seva show.`,
    };
  }
  return { label: "Breakouts", value: "Not linked", note: "Their breakout page shows the sessions for their seva." };
}

/**
 * The organisers' master-list details: the registration ID and center (both
 * editable) and what the import brought in. Rows the import left empty are
 * skipped, except the goshthi group of someone on the master list (with its
 * room and a Moderator badge when they moderate it).
 */
function registrationRows(p: DirectoryPerson): Row[] {
  const rows: Row[] = [
    {
      label: "Registration ID",
      value: p.registrationId ? (
        <span className="font-semibold tracking-wide">{p.registrationId}</span>
      ) : (
        muted("Not linked")
      ),
      note: p.registrationId ? undefined : "The master list's User Id. Imports and other lists find people by it.",
    },
  ];
  if (p.registrationStatus) rows.push({ label: "Status", value: p.registrationStatus });
  rows.push({ label: "Center", value: p.center ?? muted("Not set") });
  if (p.sevaWing) rows.push({ label: "Seva wing", value: p.sevaWing });
  // The raw "Seva" cell, when the Seva row above shows something else (the breakout team it
  // maps to). Sevas with no team are stored as given, so the two would just repeat.
  if (p.sevaRole && tidyKey(p.sevaRole) !== tidyKey(p.seva)) rows.push({ label: "Seva role", value: p.sevaRole });
  if (p.personalWing) rows.push({ label: "Personal wing", value: p.personalWing });
  // The goshthi group, its room and the moderator flag come from the import (read-only here).
  if (p.goshthiGroup) {
    rows.push({
      label: "Goshthi group",
      // Named as their breakouts page names it, e.g. "Kishore Group 4" or "Goshthi Group 12".
      value: (
        <>
          {p.goshthiLabel ?? p.goshthiGroup}
          {p.goshthiModerator && <span className={`${BADGE} ml-2 bg-coral-100 text-coral-800`}>Moderator</span>}
        </>
      ),
      note:
        p.role === "SANT"
          ? "The Santo view doesn't show goshthi groups."
          : p.goshthiModerator
            ? "Moderates this group (admin only: delegates see just the group and room). Group and room are shown on their breakouts page and their Goshthi sessions in the schedule."
            : "Shown on their breakouts page and their Goshthi sessions in the schedule.",
    });
    rows.push({ label: "Goshthi room", value: p.goshthiRoom ?? muted("Not given yet") });
  } else if (p.registrationId || p.goshthiRoom || p.goshthiModerator) {
    const stray = [p.goshthiRoom && `a room (${p.goshthiRoom})`, p.goshthiModerator && "the moderator flag"].filter(Boolean);
    rows.push({
      label: "Goshthi group",
      value: muted("Not assigned yet"),
      // A room or moderator flag without a group shows nowhere in the hub.
      note: stray.length ? `The import set ${stray.join(" and ")} but no group, so their hub shows neither.` : undefined,
      warn: stray.length > 0,
    });
  }
  return rows;
}

/**
 * Whose data a mirror test account shows in the delegate hub (or, for a sant tester, the Santo
 * view), and whether that is in effect (mirrorStatus(), the same rule as requireGuest()).
 * Read-only: `npm run testers:personas` sets it for delegates, `npm run sant:demo -- --mirror`
 * for SANTO0001.
 */
function mirrorRow(m: MirrorStatus, sant: boolean): Row {
  const t = m.target;
  return {
    label: "Mirrors",
    value: (
      <>
        <span className="font-semibold tracking-wide">
          {m.idLabel} {m.registrationId}
        </span>
        {t && (
          <span className="text-ink-700">
            {" · "}
            {t.name} ({t.bapsId})
          </span>
        )}
      </>
    ),
    note:
      m.reason ??
      (sant
        ? "Signing in as this account shows the Santo view with his personal programme, rides and utaro, seva and region, so the Seva and Region rows below are his. Sign-in, notification read state and announcements sent to specific people stay this account's own."
        : "Signing in as this account shows the delegate hub with their schedule track, seva, goshthi group, breakouts, transport and stay, so the Seva, Region, Schedule and Breakouts rows below are theirs. Sign-in, notification read state and announcements sent to specific people stay this account's own."),
    warn: !m.active,
  };
}

/** Everything on file for one person, as plain text (no mailto:/tel: links on purpose). */
export function PersonDetail({
  person,
  viewerId,
  now,
  onEdit,
  findByRegistrationId = () => undefined,
  findByBapsId = () => undefined,
  mirrorsEnabled,
  bounce,
}: {
  person: DirectoryPerson;
  viewerId: string;
  now: number;
  onEdit: () => void;
  /** Looks up the delegate a mirror test account mirrors. */
  findByRegistrationId?: (id: string) => DirectoryPerson | undefined;
  /** Looks up the sant a sant tester account mirrors (by BAPS ID). */
  findByBapsId?: (bapsId: string) => DirectoryPerson | undefined;
  /** Whether this server honours mirror test accounts (mirrorTestersEnabled() in src/lib/auth.ts). */
  mirrorsEnabled: boolean;
  /** An open SES bounce for their email address, if any (getOpenBounceNotes()). */
  bounce?: OpenBounceNote;
}) {
  const editRef = useRef<HTMLButtonElement>(null);
  const registrationHeadingId = useId();
  // Master-list people, and delegates who aren't linked yet; santos and admins only once something is on file.
  // Mirror test accounts are never on the master list (their "Mirrors" row says whose data they show).
  const showRegistration = hasRegistration(person) || (person.role === "DELEGATE" && !person.mirrorRegistrationId);

  // Coming back from the edit form, the field that had focus is gone: land on "Edit" again.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) {
      editRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const mirror = mirrorStatus(person, findByRegistrationId, mirrorsEnabled, findByBapsId);
  // An active mirror account's hub shows the mirrored delegate's seva, region, track and
  // breakouts (requireGuest(); a sant tester's, the mirrored sant's seva, region and track),
  // so those rows describe them, not this account's own row.
  const shown = mirror?.active && mirror.target ? mirror.target : person;
  const wingTrack = trackMismatch(shown);
  const rows: Row[] = [
    { label: "BAPS ID", value: <span className="font-semibold tracking-wide">{person.bapsId}</span> },
    ...(mirror ? [mirrorRow(mirror, person.role === "SANT")] : []),
    { label: "Seva", value: shown.seva },
    { label: "Region", value: shown.region ?? muted("Not set") },
    {
      label: "Schedule",
      value: trackLabel(shown),
      note: wingTrack ? `Their seva wing (${shown.sevaWing}) is on the ${wingTrack} track.` : undefined,
      warn: wingTrack !== null,
    },
    emailRow(person, bounce),
    { label: "Phone", value: person.phone ? formatPhone(person.phone) : NOT_SET },
    signInRow(person),
    breakoutsRow(shown),
    {
      label: "Last signed in",
      value: person.lastSignInAt ? timeAgo(person.lastSignInAt, now) : <span className="text-ink-500">Never</span>,
      note: person.lastSignInAt ? formatStamp(person.lastSignInAt) : undefined,
    },
    { label: "Added", value: formatStamp(person.createdAt) },
  ];

  return (
    <>
      <SheetBody>
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <RoleBadge role={person.role} />
          {person.mirrorRegistrationId ? (
            <MirrorChip registrationId={person.mirrorRegistrationId} role={person.role} />
          ) : (
            isTester(person) && <span className={`${BADGE} bg-coral-100 text-coral-800`}>Tester account</span>
          )}
          {person.id === viewerId && <span className={`${BADGE} bg-ink-900 text-white`}>You</span>}
        </div>
        <DetailList rows={rows} />
        {showRegistration && (
          <section aria-labelledby={registrationHeadingId} className="mt-5">
            <h3 id={registrationHeadingId} className="mb-2 font-display text-lg leading-tight text-ink-900">
              Registration
            </h3>
            <DetailList rows={registrationRows(person)} />
          </section>
        )}
      </SheetBody>
      <SheetFooter>
        <button ref={editRef} type="button" onClick={onEdit} className={`${BTN_PRIMARY} w-full md:w-auto`}>
          <Pencil className="h-4 w-4" />
          Edit details
        </button>
      </SheetFooter>
    </>
  );
}

function DetailList({ rows }: { rows: Row[] }) {
  return (
    <dl className="card divide-y divide-ink-800/8 overflow-hidden">
      {rows.map((row) => (
        <div key={row.label} className="px-4 py-3 sm:grid sm:grid-cols-[9.5rem_1fr] sm:gap-3">
          <dt className={`${LABEL} sm:pt-0.5`}>{row.label}</dt>
          <dd className="mt-0.5 min-w-0 text-sm text-ink-900 [overflow-wrap:anywhere] sm:mt-0">
            {row.value}
            {row.note && (
              <span className={`mt-0.5 block text-xs ${row.warn ? "font-semibold text-coral-800" : "text-ink-500"}`}>
                {row.note}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
