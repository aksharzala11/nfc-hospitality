/**
 * One-tap starting points for the announcement composer. A template only fills
 * in the message (title, text, category, link) and the audience; "When" stays
 * as the admin set it, and the announcement still goes through the usual
 * review and confirmation before anything is sent. Nothing here publishes.
 */
import { Feather, Wifi, type LucideIcon } from "lucide-react";
import { PRASANG_SUBTITLE } from "@/lib/prasang";
import type { Draft } from "./draft";

type TemplateFields = Pick<Draft, "title" | "body" | "kind" | "href" | "audience" | "roles" | "sevas" | "regions" | "hotels">;

export type AnnouncementTemplate = {
  id: string;
  /** Button label in the composer. */
  label: string;
  icon: LucideIcon;
  /** Icon tile classes. */
  tint: string;
  fields: TemplateFields;
};

export const TEMPLATES: readonly AnnouncementTemplate[] = [
  {
    // Invite delegates to the reporting team's form (the /prasang page opens it).
    id: "prasang",
    label: "Prasang form",
    icon: Feather,
    // The coral gradient: the Prasang card's invitation, set apart from the category tints.
    tint: "bg-gradient-to-br from-coral-400 to-coral-700 text-white shadow-glow",
    fields: {
      title: "Share your prasang with NAAM",
      body: `${PRASANG_SUBTITLE}. Tap to open the submission form.`,
      kind: "GENERAL",
      href: "/prasang",
      audience: "ALL",
      roles: ["DELEGATE"],
      sevas: [],
      regions: [],
      hotels: [],
    },
  },
  {
    // The venue network is open, so an announcement is all guests need (there is no Wi-Fi page).
    // No link: tapping it in the bell opens the full-screen reader.
    id: "wifi",
    label: "Venue Wi-Fi",
    icon: Wifi,
    // The teal gradient, like the other "getting around" cards.
    tint: "bg-gradient-to-br from-jade-500 to-ink-800 text-white",
    fields: {
      title: "Venue Wi-Fi: BAPS_5G",
      body: [
        "The venue Wi-Fi is an open network, so there is no password.",
        "iPhone: open Settings, tap Wi-Fi, then tap BAPS_5G.",
        "Android: open Settings, tap Network & internet (or Connections), then Wi-Fi, then BAPS_5G.",
      ].join("\n\n"),
      kind: "GENERAL",
      href: "",
      audience: "ALL",
      roles: [],
      sevas: [],
      regions: [],
      hotels: [],
    },
  },
];

/**
 * The composer after picking `t`: its message and audience filters, with the
 * current "When" and the specific people already picked. The people stay on
 * purpose ("send the Wi-Fi details to the one person who asked"): while any
 * are picked it goes only to them, so a template never widens a personal
 * draft into one for everyone. Clearing the people gives the template's own
 * audience.
 */
export function draftFromTemplate(t: AnnouncementTemplate, current: Draft): Draft {
  const f = t.fields;
  return {
    ...current,
    title: f.title,
    body: f.body,
    kind: f.kind,
    href: f.href,
    audience: f.audience,
    roles: [...f.roles],
    sevas: [...f.sevas],
    regions: [...f.regions],
    hotels: [...f.hotels],
  };
}

function sameValues(a: readonly string[], b: readonly string[]) {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * True while the composer holds exactly this template's message and audience
 * filters (picking it again would change nothing: picked people stay either way).
 */
export function matchesTemplate(d: Draft, t: AnnouncementTemplate): boolean {
  const f = t.fields;
  return (
    d.title === f.title &&
    d.body === f.body &&
    d.kind === f.kind &&
    d.href === f.href &&
    d.audience === f.audience &&
    sameValues(d.roles, f.roles) &&
    sameValues(d.sevas, f.sevas) &&
    sameValues(d.regions, f.regions) &&
    sameValues(d.hotels, f.hotels)
  );
}
