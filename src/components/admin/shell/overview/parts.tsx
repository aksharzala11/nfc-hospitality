import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { formatMinutes } from "@/lib/admin/overview";
import { BADGE, BUTTON, DRIFT_TONE, FOCUS } from "@/components/admin/shell/ui";

/** "+15 min" / "−10 min" */
export function signed(minutes: number) {
  return `${minutes > 0 ? "+" : "−"}${formatMinutes(minutes)}`;
}

/** How far a programme item or breakout moved from its printed start (or end): coral later, jade earlier. */
export function ShiftBadge({ item }: { item: { startShift: number; endShift: number } }) {
  const minutes = item.startShift || item.endShift;
  if (!minutes) return null;
  return (
    <span className={`${BADGE} ${minutes > 0 ? DRIFT_TONE.late : DRIFT_TONE.early}`}>
      {item.startShift ? "" : "Ends "}
      {signed(minutes)}
    </span>
  );
}

/** Title row of an overview card, with a link to the console page behind it (44px tap target). */
export function CardHeader({
  id,
  title,
  subtitle,
  href,
  linkLabel,
}: {
  /** Id for the heading, referenced by the card's aria-labelledby. */
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-800/8 py-2.5 pl-4 pr-2">
      <div className="min-w-0 py-1">
        <h2 id={id} className="font-display text-xl leading-tight text-ink-900">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-ink-500">{subtitle}</p>}
      </div>
      <Link
        href={href}
        className={`inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-xl px-3 text-xs font-semibold text-ink-600 transition hover:bg-ink-800/5 hover:text-ink-900 ${FOCUS}`}
      >
        {linkLabel}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Centred placeholder for a card with nothing to list yet, with an optional call to action. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="px-6 py-8 text-center">
      <span className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mx-auto mt-0.5 max-w-xs text-xs leading-snug text-ink-500">{body}</p>
      {action && (
        <Link href={action.href} className={`${BUTTON.secondary} mt-4`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
