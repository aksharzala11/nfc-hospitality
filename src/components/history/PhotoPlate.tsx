"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getScroller } from "@/lib/scroll";
import { historyPhotoSources, photographsLabel, type HistoryPhoto } from "@/lib/history";
import { PhotoViewer } from "./PhotoViewer";
import styles from "./history.module.css";

/**
 * One event's photographs on the History timeline: a white mat with the event's name on top,
 * the photographs one per row in their order, and a tap on one opens it in the viewer.
 *
 * Sacred images. Each is a plain <img> of its whole frame at its own aspect ratio (width and
 * height from the build's manifest, so the page never shifts as they load): no cropping
 * (never object-fit: cover), no rounded corners, nothing laid over it, no placeholder blur, no
 * hover / press / transition styles, and nothing on the mat or anything else that contains it
 * that would alter it (transform, opacity, filter, mask, animation, clipping overflow). The mat
 * is position: relative only so that it paints over the timeline's line.
 */
export function PhotoPlate({ caption, items }: { caption: string; items: HistoryPhoto[] }) {
  const figureRef = useRef<HTMLElement>(null);
  /** The mat is within a screen or so of view: load its photographs now. */
  const [near, setNear] = useState(false);
  /**
   * The photograph that is open in the viewer, and the button that opened it: focus goes back
   * to that button on close. Kept from the click itself, not read from document.activeElement:
   * Safari doesn't focus a button that is tapped or clicked.
   */
  const [open, setOpen] = useState<{ index: number; opener: HTMLButtonElement } | null>(null);

  // loading="lazy" alone isn't dependable inside a scroll container on older iOS (the page
  // scrolls #app-scroll, not the document), so watch the mat against the scroller ourselves.
  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root: getScroller(), rootMargin: "1200px 0px" },
    );
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={figureRef} className="relative -ml-7 mt-4 rounded-2xl border border-sand-300 bg-white p-2">
      <figcaption className="px-1 pb-2 pt-1">
        <span className="block text-[15px] font-semibold leading-snug text-ink-900">{caption}</span>
        <span className="mt-0.5 block text-xs text-ink-500">{photographsLabel(items.length)}</span>
      </figcaption>

      <ol className="flex flex-col gap-2">
        {items.map((photo, i) => {
          const source = historyPhotoSources(photo.key);
          return (
            <li key={photo.key}>
              <button
                type="button"
                onClick={(event) => setOpen({ index: i, opener: event.currentTarget })}
                // width / height of the file: the button (and so the photograph) is sized from it.
                style={{ "--photo-ratio": source.width / source.height } as CSSProperties}
                className={`cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800 ${styles.photoButton}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- shown exactly as the file is: no optimiser, no cropping */}
                <img
                  src={source.src}
                  srcSet={source.srcSet}
                  // The mat's inner width: the page's 16px gutters, the mat's 8px padding and 1px border.
                  sizes="(min-width: 512px) 462px, calc(100vw - 50px)"
                  width={source.width}
                  height={source.height}
                  alt={photo.alt}
                  loading={near ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                  // The text classes style the alt text, should a photograph fail to load.
                  className="block h-auto w-full text-sm leading-relaxed text-ink-600"
                />
                <span className="sr-only">. View larger.</span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="px-1 pb-1 pt-2 text-xs text-ink-500">Tap a photo to see it larger</p>

      {open !== null && (
        <PhotoViewer
          caption={caption}
          items={items}
          start={open.index}
          opener={open.opener}
          onClose={() => setOpen(null)}
        />
      )}
    </figure>
  );
}
