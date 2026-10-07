import { Bus, CalendarDays, Megaphone, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { NotificationKind } from "@prisma/client";
import { KIND_TINT } from "@/components/brand/kindTints";

/**
 * Category icons and tints. The tints come from the shared source,
 * src/components/brand/kindTints.ts (KIND_TINT), which the header bell
 * (src/components/NotificationBell.tsx) uses too, so a kind reads the same in
 * the composer, history, bell preview, console overview and the guests' bell.
 * `label` names the category in the composer, `bellLabel` is what the bell prints.
 */
export const KIND_META: Record<NotificationKind, { icon: LucideIcon; tint: string; label: string; bellLabel: string }> = {
  GENERAL: { icon: Megaphone, tint: KIND_TINT.GENERAL, label: "General", bellLabel: "Announcement" },
  SCHEDULE: { icon: CalendarDays, tint: KIND_TINT.SCHEDULE, label: "Schedule", bellLabel: "Schedule" },
  TRANSPORT: { icon: Bus, tint: KIND_TINT.TRANSPORT, label: "Transport", bellLabel: "Transportation" },
  MENU: { icon: UtensilsCrossed, tint: KIND_TINT.MENU, label: "Menu", bellLabel: "Menu" },
};
