"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * The only script of /sant/breakouts: a breakout block's card, whose header is the button that
 * shows or hides the block's sessions (an accordion section: the button inside the heading, with
 * aria-expanded / aria-controls). Several blocks may be open at once. The server renders the
 * header's content and the sessions (SantBreakoutBlocks); this keeps only whether it is open,
 * which an AutoRefresh re-render leaves as it is.
 */
export function SantBlockToggle({
  panelId,
  defaultOpen,
  className,
  buttonClassName,
  chevronClassName,
  header,
  children,
}: {
  /** The id of the sessions' panel (aria-controls). */
  panelId: string;
  defaultOpen: boolean;
  /** The card's own classes (now / past looks). */
  className: string;
  buttonClassName: string;
  chevronClassName: string;
  /** The header's content: phrasing content only (spans), since it sits inside the button. */
  header: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={className}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className={`flex min-h-11 w-full items-start gap-3 p-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-coral-700 ${
            open ? "rounded-t-3xl" : "rounded-3xl"
          } ${buttonClassName}`}
        >
          <span className="min-w-0 flex-1">{header}</span>
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${chevronClassName}`}
          >
            <ChevronDown
              className={`h-5 w-5 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
              strokeWidth={2.4}
            />
          </span>
        </button>
      </h2>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
