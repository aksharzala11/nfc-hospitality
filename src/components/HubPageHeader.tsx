/**
 * Title block for the delegate hub's content pages (schedule, menu, breakouts,
 * transportation, history, prasang), in the Sāchu brand guide's voice: a
 * short coral-gradient rule and a wide-tracked Just Sans kicker, then the page
 * name in Enilas. `children` sits under the subtitle (e.g. the breakouts' seva chip).
 */
export function HubPageHeader({
  eyebrow,
  title,
  titleId,
  subtitle,
  children,
}: {
  /** Short kicker above the title, shown in tracked capitals. */
  eyebrow?: string;
  title: string;
  /**
   * Gives the title an id and lets a script move focus to it (tabIndex -1): the History page's
   * "Back to the start". Its scroll margin is larger than the header, so a jump to it lands at
   * the very top of the page.
   */
  titleId?: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {eyebrow && (
        <p className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.24em] text-coral-800">
          <span aria-hidden="true" className="h-[3px] w-6 shrink-0 rounded-full bg-gradient-to-r from-coral-400 to-coral-700" />
          {eyebrow}
        </p>
      )}
      <h1
        id={titleId}
        tabIndex={titleId ? -1 : undefined}
        // The ring shows only after a keyboard jump (HistoryJump's data-keyboard-focus), never
        // after a tap: `outline-solid` brings back the style `outline-none` switches off.
        className={`font-display mt-2 text-balance text-4xl leading-[1.1] text-ink-900 ${
          titleId
            ? "scroll-mt-24 rounded-sm outline-none data-[keyboard-focus]:focus:outline-2 data-[keyboard-focus]:focus:outline-offset-4 data-[keyboard-focus]:focus:outline-ink-800 data-[keyboard-focus]:focus:outline-solid"
            : ""
        }`}
      >
        {title}
      </h1>
      {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{subtitle}</p>}
      {children}
    </header>
  );
}
