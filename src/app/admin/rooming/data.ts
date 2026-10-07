/**
 * Server-only data for the admin rooming board (/admin/rooming) (imports
 * Prisma; never import this from a client component). Callers have checked
 * requireAdmin(): the board lists names and BAPS IDs.
 */
import { getHelpCoverage, type HelpCoverage } from "@/lib/helpContacts";
import {
  getRoomingBoard,
  isRoomingTableMissing,
  type RoomingBoard,
  type RoomingBoardFilters,
} from "@/lib/rooming";

/**
 * The board for one stay (and optionally one hotel) under the console's seva
 * filter. null while the database has no room_assignments table yet (the
 * schema is pushed before the first `npm run rooming:import`), so the console
 * keeps working until then.
 */
export async function loadRoomingBoard(filters: RoomingBoardFilters): Promise<RoomingBoard | null> {
  try {
    return await getRoomingBoard(filters);
  } catch (err) {
    if (isRoomingTableMissing(err)) return null;
    throw err;
  }
}

/**
 * Which tracks' delegates have someone to call about their hotel room: a
 * hotlines row with role DELEGATE and topic STAY or GENERAL for their track,
 * shown on /stay (src/lib/helpContacts.ts). A track without one sees no
 * contact there (the Hotel Liaisons on the stay cards aside), so the board
 * points that out.
 */
export async function stayHelpCoverage(): Promise<HelpCoverage> {
  return getHelpCoverage("STAY");
}
