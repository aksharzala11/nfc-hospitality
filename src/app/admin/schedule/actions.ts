"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notificationPeople";
import { EVENT_DAYS } from "@/lib/time";
import { executeScheduleOp, ScheduleConflictError, ScheduleOpError, type ScheduleOp } from "@/lib/admin/schedule";

const id = z.string().trim().min(1).max(64);
const scope = z.enum(["ONLY", "TRACK", "ALL"]);
// Only bounds the input; the planner enforces the real limits (3 h per change,
// up to a day when shortening a single item) with friendlier messages.
const minutes = z
  .number()
  .int()
  .min(-24 * 60)
  .max(24 * 60)
  .refine((n) => n !== 0);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const opSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SHIFT"), itemId: id, minutes, scope }),
  z.object({ kind: z.literal("EXTEND"), itemId: id, minutes, scope }),
  z.object({ kind: z.literal("EDIT"), itemId: id, start: clock, end: clock }),
  z.object({ kind: z.literal("RESET_ITEM"), itemId: id }),
  z.object({ kind: z.literal("RESET_DAY"), day: z.enum(EVENT_DAYS) }),
  z.object({ kind: z.literal("UNDO"), changeId: id }),
]);

const inputSchema = z.object({
  op: opSchema,
  /** SchedulePlan.fingerprint of the preview the admin confirmed. */
  expected: z.string().min(1).max(32),
  /** Also publish a SCHEDULE notification to the anchor item's audience. */
  notify: z.boolean(),
});

export type ScheduleChangeInput = {
  op: ScheduleOp;
  /** SchedulePlan.fingerprint of the preview the admin confirmed. */
  expected: string;
  notify: boolean;
};

export type ScheduleChangeResult =
  | { ok: true; changeId: string; summary: string; notified: boolean }
  | { ok: false; error: string; conflict?: boolean };

/** Pages that show schedule, meal (menu reveal) or breakout times. */
const AFFECTED_PATHS = ["/admin/schedule", "/admin", "/schedule", "/dashboard", "/menu", "/breakouts", "/sant", "/sant/schedule"];

/**
 * Applies one live-schedule change (shift, extend, exact edit, reset, undo)
 * in a single transaction, logs it to schedule_changes and optionally
 * notifies guests. Refuses when the schedule no longer matches the preview the
 * admin confirmed (`expected`), so nobody applies a change they didn't see.
 */
export async function applyScheduleChange(input: ScheduleChangeInput): Promise<ScheduleChangeResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Only admins can change the schedule. Please sign in again." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change isn't valid. Refresh the page and try again." };
  const { op, expected, notify } = parsed.data;

  try {
    const result = await prisma.$transaction(
      (tx) =>
        executeScheduleOp(tx, {
          op,
          adminId: admin.id,
          expectedFingerprint: expected,
          notify,
          // The one way notifications are stored (also before notifications.user_ids is pushed).
          publishNotice: createNotification,
        }),
      { maxWait: 10_000, timeout: 20_000 },
    );
    for (const path of AFFECTED_PATHS) revalidatePath(path);
    return { ok: true, changeId: result.changeId, summary: result.plan.summary, notified: result.notificationId !== null };
  } catch (e) {
    if (e instanceof ScheduleConflictError) {
      // Send the admin's page fresh data so the preview they re-check is current.
      revalidatePath("/admin/schedule");
      return { ok: false, error: e.message, conflict: true };
    }
    if (e instanceof ScheduleOpError) return { ok: false, error: e.message };
    console.error("applyScheduleChange failed", e);
    return { ok: false, error: "Something went wrong, so nothing was changed. Please try again." };
  }
}
