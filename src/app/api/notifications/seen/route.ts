import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Marks every notification up to now as read for the signed-in guest. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  await prisma.user.updateMany({
    where: { id: session.sub },
    data: { notificationsSeenAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
