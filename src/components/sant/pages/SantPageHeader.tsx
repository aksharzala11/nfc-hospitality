/**
 * Title block for the Pujya Santo pages (/sant/schedule, /sant/stay,
 * /sant/transport, /sant/menu, /sant/breakouts, /sant/map): the page name in Enilas, a
 * quiet subtitle, and a short rule in the view's accent, the brand's coral
 * gradient deepening into ember, finished with a bead.
 */
export function SantPageHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="font-display text-[2.1rem] leading-[1.1] text-ink-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-600">{subtitle}</p>}
      <span aria-hidden="true" className="mt-3 flex items-center gap-1.5">
        <span className="block h-[3px] w-12 rounded-full bg-gradient-to-r from-coral-400 via-coral-700 to-ember-700" />
        <span className="block h-[5px] w-[5px] rounded-full bg-ember-700" />
      </span>
    </header>
  );
}
