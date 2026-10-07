"use server";

import { revalidatePath } from "next/cache";
import { getAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reopenBounceRecord, resolveBounceRecord, type BounceActionResult } from "@/lib/admin/emailEvents";

const NOT_ADMIN: BounceActionResult = {
  ok: false,
  error: "Only admins can change the bounce tracker. Sign in again with an admin account.",
};

const FAILED: BounceActionResult = { ok: false, error: "Couldn't save just now. Check your connection and try again." };

/** Pages that show a bounce's status: the tracker, the Overview card and the directory's note. */
function revalidate() {
  revalidatePath("/admin/bounces");
  revalidatePath("/admin");
  revalidatePath("/admin/delegates");
}

/** Marks every open event of `recipient` resolved, with an optional short note. */
export async function resolveBounce(recipient: string, note: string): Promise<BounceActionResult> {
  const admin = await getAdmin();
  if (!admin) return NOT_ADMIN;
  try {
    const result = await resolveBounceRecord(prisma, admin.id, recipient, note);
    if (result.ok) revalidate();
    return result;
  } catch (err) {
    console.error("resolveBounce failed", (err as { code?: unknown })?.code ?? "");
    return FAILED;
  }
}

/** Opens `recipient` again (its note stays). */
export async function reopenBounce(recipient: string): Promise<BounceActionResult> {
  const admin = await getAdmin();
  if (!admin) return NOT_ADMIN;
  try {
    const result = await reopenBounceRecord(prisma, recipient);
    if (result.ok) revalidate();
    return result;
  } catch (err) {
    console.error("reopenBounce failed", (err as { code?: unknown })?.code ?? "");
    return FAILED;
  }
}
