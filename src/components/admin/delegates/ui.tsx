import type { UserRole } from "@prisma/client";
import type { DirectoryPerson } from "@/lib/admin/delegates";
import { initials } from "@/lib/users";
import { BADGE as KIT_BADGE, BUTTON, FOCUS, LABEL as KIT_LABEL, ROLE_BADGE } from "@/components/admin/shell/ui";
import { mirrorIdLabel, signedInLabel } from "./directory";

/*
 * Class strings for the directory. Buttons, badges and labels come from the
 * console's shared kit; the rest is specific to this page.
 *
 * Each variant is a complete class list rather than overrides appended to a
 * base: without tailwind-merge, two utilities for the same property (e.g.
 * border-ink-800/15 and border-ember-500/60) resolve by their order in the
 * generated CSS, not in the class attribute, and the appended one often loses.
 */

export const BTN_PRIMARY = BUTTON.primary;
export const BTN_SECONDARY = BUTTON.secondary;
export const BADGE = KIT_BADGE;
/** BUTTON.secondary sized to sit beside a text input (the input is 44px tall too). */
export const BTN_SECONDARY_COMPACT = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-ink-800/12 bg-white/85 px-3.5 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:border-ink-800/20 hover:bg-white active:scale-[0.98] disabled:opacity-50 ${FOCUS}`;

const INPUT_SHAPE =
  "min-h-11 w-full rounded-xl border px-3.5 py-2.5 text-base outline-none transition placeholder:text-ink-400 md:text-sm";
export const INPUT = `${INPUT_SHAPE} border-ink-800/15 bg-white text-ink-900 hover:border-ink-800/25 focus:border-coral-500 focus:ring-2 focus:ring-coral-400/35`;
/** Use instead of INPUT (not with it) for a field with an error. */
export const INPUT_INVALID = `${INPUT_SHAPE} border-ember-500/60 bg-white text-ink-900 focus:border-ember-500 focus:ring-2 focus:ring-ember-500/20`;
/** A value shown in field form that can't be edited (the BAPS ID when editing). */
export const INPUT_READONLY = `${INPUT_SHAPE} cursor-default border-dashed border-ink-800/20 bg-sand-100 font-semibold tracking-wide text-ink-700 focus:ring-2 focus:ring-ink-800/10`;
export const LABEL = KIT_LABEL;

/**
 * Filter chip. `before:` widens the hit area to 44px tall without making the
 * pill itself bulky (rows of chips wrap with a small gap).
 */
export const CHIP = `relative min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${FOCUS}`;
export const CHIP_ON = "border-ink-900 bg-ink-900 text-white";
export const CHIP_OFF = "border-ink-800/12 bg-white/85 text-ink-700 hover:border-ink-800/25 hover:bg-white";
/**
 * Use instead of CHIP_OFF (not with it) for an unpicked value that reaches nobody:
 * dashed and muted in solid ink-500 (AA on white), still tappable.
 */
export const CHIP_EMPTY = "border-dashed border-ink-800/20 bg-white/60 text-ink-500 hover:border-ink-800/30 hover:bg-white";
/** Count inside a chip. */
export const chipCount = (on: boolean) => `ml-1.5 tabular-nums ${on ? "text-white/70" : "text-ink-500"}`;

export function RoleBadge({ role }: { role: UserRole }) {
  return <span className={`${BADGE} ${ROLE_BADGE[role].tone} whitespace-nowrap`}>{ROLE_BADGE[role].label}</span>;
}

/**
 * "Test · mirrors User Id N" on a mirror test account (users.mirror_registration_id, see
 * requireGuest() in src/lib/auth.ts), "Test · mirrors BAPS ID X" on a sant tester's (he
 * mirrors a sant by BAPS ID: mirrorIdLabel()), in the tester badge's coral (coral-800 on
 * coral-100: AA). Truncates rather than widening a narrow table cell; the title keeps the
 * full text.
 */
export function MirrorChip({ registrationId, role }: { registrationId: string; role: UserRole }) {
  const text = `Test · mirrors ${mirrorIdLabel(role)} ${registrationId}`;
  return (
    <span title={text} className={`${BADGE} inline-block max-w-full truncate whitespace-nowrap bg-coral-100 align-middle text-coral-800`}>
      {text}
    </span>
  );
}

/** Delegates on sand, santos in the coral → ember warmth of their view, admins in the console's ink. */
const AVATAR_TONE: Record<UserRole, string> = {
  DELEGATE: "bg-sand-200 text-ink-700",
  SANT: "bg-gradient-to-br from-coral-600 to-ember-600 text-white",
  ADMIN: "bg-gradient-to-br from-ink-700 to-ink-900 text-white",
};

/** Initials in a circle, tinted by role. Decorative: the name is always next to it. */
export function Avatar({ person, size = "md" }: { person: Pick<DirectoryPerson, "name" | "role">; size?: "sm" | "md" | "lg" }) {
  const sizing =
    size === "lg" ? "h-12 w-12 text-sm" : size === "sm" ? "h-8 w-8 text-[10px]" : "h-10 w-10 text-[11px]";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-bold tracking-wide ${sizing} ${AVATAR_TONE[person.role]}`}
    >
      {initials(person)}
    </span>
  );
}

/**
 * Jade dot once someone has signed in, an empty ring if they never have.
 * `decorative`: the same information is written next to it.
 */
export function SignInDot({ at, now, decorative = false }: { at: string | null; now: number; decorative?: boolean }) {
  const label = signedInLabel(at, now);
  return (
    <span
      title={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={`relative inline-block h-2 w-2 shrink-0 rounded-full ${
        at ? "bg-jade-500 ring-2 ring-jade-500/20" : "border border-ink-400"
      }`}
    >
      {!decorative && <span className="sr-only">{label}</span>}
    </span>
  );
}
