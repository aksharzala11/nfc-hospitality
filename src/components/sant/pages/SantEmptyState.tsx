import type { LucideIcon } from "lucide-react";

/**
 * Gentle placeholder for sant data that hasn't been entered yet (no personal
 * programme, utaro, hotline or rides). "sm" is the compact version used when
 * other content shares the page.
 */
export function SantEmptyState({
  icon: Icon,
  title,
  children,
  action,
  size = "md",
  headingLevel = 2,
}: {
  icon: LucideIcon;
  title: string;
  /** One or two sentences of plain text. */
  children?: React.ReactNode;
  action?: React.ReactNode;
  size?: "md" | "sm";
  /** 3 when the placeholder sits under a section's own h2. */
  headingLevel?: 2 | 3;
}) {
  const sm = size === "sm";
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={`card flex flex-col items-center text-center ${sm ? "px-5 py-6" : "px-6 py-10"}`}>
      {/* The view's accent: coral deepening into ember (white icon stays ≥ 3:1 on every part). */}
      <span
        className={`flex items-center justify-center bg-gradient-to-br from-coral-600 to-ember-600 text-white shadow-glow ${
          sm ? "mb-3 h-12 w-12 rounded-xl" : "mb-4 h-16 w-16 rounded-2xl"
        }`}
      >
        <Icon className={sm ? "h-6 w-6" : "h-8 w-8"} strokeWidth={2} />
      </span>
      <Heading className={`font-display leading-snug text-ink-900 ${sm ? "text-xl" : "text-[1.4rem]"}`}>{title}</Heading>
      {children && <p className="mt-2 max-w-xs text-sm text-ink-600">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}
