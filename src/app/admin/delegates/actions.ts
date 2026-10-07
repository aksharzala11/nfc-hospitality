"use server";

import { revalidatePath } from "next/cache";
import { getAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createPersonRecord,
  updatePersonRecord,
  type PersonPayload,
  type SavePersonResult,
} from "@/lib/admin/delegates";

const NOT_ADMIN: SavePersonResult = {
  ok: false,
  error: "Only admins can change the directory. Sign in again with an admin account.",
};

const FAILED: SavePersonResult = {
  ok: false,
  error: "Couldn't save just now. Check your connection and try again.",
};

/**
 * Adds a person from the directory's add form. A BAPS ID or registration ID
 * that's already taken comes back as a field error on that field.
 */
export async function createPerson(values: PersonPayload): Promise<SavePersonResult> {
  const admin = await getAdmin();
  if (!admin) return NOT_ADMIN;
  try {
    const result = await createPersonRecord(prisma, values);
    if (result.ok) revalidatePath("/admin/delegates");
    return result;
  } catch (err) {
    console.error("createPerson failed", err);
    return FAILED;
  }
}

/**
 * Saves the directory's edit form for person `id`. Their BAPS ID, test code,
 * breakout links and import-only master-list fields stay as they are; a
 * registration ID someone else has comes back as a field error.
 */
export async function updatePerson(id: string, values: PersonPayload): Promise<SavePersonResult> {
  const admin = await getAdmin();
  if (!admin) return NOT_ADMIN;
  try {
    const result = await updatePersonRecord(prisma, admin.id, id, values);
    if (result.ok) revalidatePath("/admin/delegates");
    return result;
  } catch (err) {
    console.error("updatePerson failed", err);
    return FAILED;
  }
}
