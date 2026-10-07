import type { NotificationKind } from "@prisma/client";

/**
 * Icon-tile colours for the four notification kinds, in the Sāchu palette. One source for
 * the header bell (src/components/NotificationBell.tsx), the admin composer's preview
 * (src/components/admin/announcements/kinds.ts) and the overview feed
 * (src/components/admin/shell/overview/RecentActivity.tsx), so a kind reads the same
 * everywhere. A plain (non-client) module, so server components can import it too.
 *
 * Each is distinct at a glance and passes 3:1 for the icon:
 *  - MENU       coral on pale coral (food, the delegate hub's accent)
 *  - SCHEDULE   ink on pale ink (neutral information)
 *  - TRANSPORT  jade on pale jade (the teal gradient's light end)
 *  - GENERAL    coral on an ink tile: the brand's own "coral on ink" voice, for organiser
 *               announcements
 */
export const KIND_TINT: Record<NotificationKind, string> = {
  MENU: "bg-coral-100 text-coral-800",
  SCHEDULE: "bg-ink-100 text-ink-800",
  TRANSPORT: "bg-jade-100 text-jade-700",
  GENERAL: "bg-ink-800 text-coral-300",
};
