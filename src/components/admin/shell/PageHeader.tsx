import type { ReactNode } from "react";
import { EYEBROW } from "@/components/admin/shell/ui";

/**
 * Title block of a console page, in the brand's type pairing: a wide-tracked
 * caps eyebrow, the page title in Enilas and one line of context, with an
 * optional action (a button or link) on the right. Server- and client-safe.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow = "Admin console",
  className = "mb-5",
}: {
  title: string;
  description?: ReactNode;
  /** Sits to the right of the title, aligned with it. */
  action?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <header className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <p className={EYEBROW}>{eyebrow}</p>
        <h1 className="mt-1 font-display text-[2rem] leading-[1.1] text-ink-900">{title}</h1>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{description}</p>}
      </div>
      {action && <div className="shrink-0 pt-5">{action}</div>}
    </header>
  );
}
