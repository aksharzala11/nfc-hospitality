/**
 * Server-only data for the admin transport board (/admin/transport) and its
 * card on the console home (imports Prisma; never import this from a client
 * component). Callers have checked requireAdmin(): the board lists names and
 * phone numbers.
 */
import { getHelpCoverage, type HelpCoverage } from "@/lib/helpContacts";
import {
  getTransportBoard,
  isTransportTableMissing,
  type TransportBoard,
  type TransportDirection,
} from "@/lib/transport";

/**
 * The board for one direction under the console's seva filter, every day
 * included (the page picks the day, so the day chips can count them all).
 * null while the database has no transport_legs table yet (the schema is
 * pushed before the first `npm run transport:import`), so the console keeps
 * working until then.
 */
export async function loadTransportBoard(
  direction: TransportDirection,
  sevas: readonly string[],
): Promise<TransportBoard | null> {
  try {
    return await getTransportBoard(direction, { sevas });
  } catch (err) {
    if (isTransportTableMissing(err)) return null;
    throw err;
  }
}

/**
 * Which tracks' delegates have someone to call about transport: a hotlines row
 * with role DELEGATE and topic TRANSPORT or GENERAL for their track, shown on
 * /transportation (src/lib/helpContacts.ts). A track without one sees no
 * contact there, so the board points that out.
 */
export async function transportHelpCoverage(): Promise<HelpCoverage> {
  return getHelpCoverage("TRANSPORT");
}
