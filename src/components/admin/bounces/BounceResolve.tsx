"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, RotateCcw } from "lucide-react";
import { reopenBounce, resolveBounce } from "@/app/admin/bounces/actions";
import { NOTE_MAX } from "@/lib/emailEvents/view";
import { BUTTON, LABEL } from "@/components/admin/shell/ui";

const INPUT =
  "min-h-11 w-full rounded-xl border border-ink-800/15 bg-white px-3.5 py-2.5 text-base text-ink-900 outline-none transition placeholder:text-ink-400 hover:border-ink-800/25 focus:border-coral-500 focus:ring-2 focus:ring-coral-400/35 md:text-sm";

/**
 * "Mark resolved" (with an optional short note) on an open address, "Reopen"
 * on a resolved one. The server actions check getAdmin() themselves and
 * revalidate the tracker, so the page re-renders with the new status.
 */
export function BounceResolve({ recipient, open, note }: { recipient: string; open: boolean; note: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const errorId = useId();

  /** Set when the note form closes by Cancel / Escape: focus goes back to "Mark resolved". */
  const refocusRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (refocusRef.current) {
      refocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const cancel = () => {
    refocusRef.current = true;
    setEditing(false);
    setError(null);
  };

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      let result: { ok: true } | { ok: false; error: string };
      try {
        result = await action();
      } catch {
        result = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  };

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reopenBounce(recipient))}
          className={BUTTON.secondary}
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          {pending ? "Reopening…" : "Reopen"}
        </button>
        {error && (
          <p role="alert" className="text-xs font-semibold text-ember-600">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setDraft(note ?? "");
          setError(null);
          setEditing(true);
        }}
        className={BUTTON.secondary}
      >
        <Check aria-hidden="true" className="h-4 w-4" />
        Mark resolved
      </button>
    );
  }

  return (
    <form
      className="w-full space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => resolveBounce(recipient, draft));
      }}
    >
      <label htmlFor={inputId} className={LABEL}>
        Note <span className="font-semibold normal-case tracking-normal">(optional)</span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={draft}
        maxLength={NOTE_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pending) {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder="e.g. Email corrected in the directory"
        aria-describedby={error ? errorId : undefined}
        className={INPUT}
        autoComplete="off"
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-ember-600">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON.primary}>
          <Check aria-hidden="true" className="h-4 w-4" />
          {pending ? "Saving…" : "Mark resolved"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className={BUTTON.secondary}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
