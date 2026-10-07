"use client";

import { useSyncExternalStore } from "react";

/**
 * The breakouts page's Step-free choice, one for all its "How to get there" sections and kept for
 * this viewer (localStorage; a per-viewer convenience, nothing else reads it). Storage can be
 * missing or throw (private windows, blocked site data): then the choice lasts until the page is
 * left. The server (and hydration) always renders it off.
 */
const KEY = "hh:breakouts:step-free";
const EVENT = "hh:step-free-change";

/** The choice as last read or set; null = not read from storage yet. */
let current: boolean | null = null;

function read(): boolean {
  if (current === null) {
    try {
      current = window.localStorage.getItem(KEY) === "1";
    } catch {
      current = false;
    }
  }
  return current;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
    current = null;
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function write(on: boolean) {
  current = on;
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Kept in memory for this page only.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** [on, set]: every section of the page shows the same choice. */
export function useStepFreePreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  return [on, write];
}
