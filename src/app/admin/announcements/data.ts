/**
 * Server-only data for /admin/announcements (imports Prisma; never import
 * this from a client component).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  countReach,
  describeAudience,
  fromStored,
  type AnnouncementView,
  type FacetGroup,
} from "@/lib/admin/announcements";
import { getPeopleByIds, toPersonPick, type ListedPerson } from "@/lib/admin/announcementPeople";
import { withPeopleColumn } from "@/lib/notificationPeople";
import {
  scopeGroups,
  scopeReach,
  type ScopedAnnouncementView,
  type SevaScope,
} from "@/components/admin/announcements/sevaScope";
import { dayKey, formatDayShort, formatRelative, formatTime } from "@/lib/time";
import { greetingName } from "@/lib/users";

/** Rows sent to the page; the history shows them 20 at a time. */
const HISTORY_LIMIT = 200;
/**
 * With a seva filter, how many candidate rows (no seva targeting, or one of the
 * filtered sevas) are checked against the full rule before the newest
 * HISTORY_LIMIT matches are kept. Far above what one event produces; past it,
 * the "of {total}" count only covers the rows checked.
 */
const SCOPED_SCAN_LIMIT = 2000;

/** Every column the history shows except `userIds`, which a database may not have yet. */
const ROW_SELECT = {
  id: true,
  kind: true,
  title: true,
  body: true,
  href: true,
  audience: true,
  roles: true,
  sevas: true,
  regions: true,
  createdAt: true,
  createdById: true,
  createdBy: { select: { name: true, displayName: true } },
} satisfies Prisma.NotificationSelect;
const ROW_SELECT_PEOPLE = { ...ROW_SELECT, userIds: true } satisfies Prisma.NotificationSelect;
/** A row as the rule reads it: its hotels out of `regions` (fromStored()). */
type NotificationRow = ReturnType<
  typeof fromStored<Prisma.NotificationGetPayload<{ select: typeof ROW_SELECT_PEOPLE }>>
>;

/**
 * Rows for the history, each with the accounts it lists (`userIds`; none for
 * an ordinary announcement) and its hotels taken out of `regions`. On a database
 * without notifications.user_ids yet the column isn't read and every row is an
 * ordinary one (withPeopleColumn()).
 */
function findRows({
  where,
  take,
}: {
  /** The filter, given whether this database has `user_ids` (so it may name the column only then). */
  where?: (people: boolean) => Prisma.NotificationWhereInput;
  take: number;
}): Promise<NotificationRow[]> {
  const orderBy = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.NotificationOrderByWithRelationInput[];
  return withPeopleColumn(async (people): Promise<NotificationRow[]> => {
    const args = { where: where?.(people), take, orderBy };
    if (people) return (await prisma.notification.findMany({ ...args, select: ROW_SELECT_PEOPLE })).map(fromStored);
    const rows = await prisma.notification.findMany({ ...args, select: ROW_SELECT });
    return rows.map((r) => fromStored({ ...r, userIds: [] }));
  });
}

/** The accounts the personal announcements among `rows` list that still exist, by id (one query). */
function listedPeople(rows: readonly NotificationRow[]): Promise<Map<string, ListedPerson>> {
  return getPeopleByIds(rows.flatMap((n) => n.userIds));
}

/** The composer's anonymous facet groups (role / gender / seva / region / hotels). */
export { getFacetGroups } from "@/lib/admin/announcementFacets";

/**
 * Every organiser notification, newest publish time first (scheduled ones
 * first), with its reach recounted from `groups` and labels formatted for `now`.
 * A personal announcement carries the people it lists who still have an
 * account (names: this page is admin only); its reach is how many those are.
 *
 * With a seva `scope` (the console's seva filter), only the ones that reach at
 * least one person of those sevas, by the same rule as the bell (so a row with
 * no seva targeting counts when its role, track and region reach them, and a
 * personal one when it lists one of them); each carries `sevaReach`, how many
 * of those people it reaches, and `total` is the number of matches.
 */
export async function getAnnouncementHistory(
  now: Date,
  adminId: string,
  groups: readonly FacetGroup[],
  scope: SevaScope | null = null,
): Promise<{ items: ScopedAnnouncementView[]; total: number }> {
  const view = (n: NotificationRow, byId: Map<string, ListedPerson>): AnnouncementView => {
    const scheduled = n.createdAt.getTime() > now.getTime();
    const personal = n.userIds.length > 0;
    const people = n.userIds.flatMap((id) => byId.get(id) ?? []);
    return {
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href,
      audience: n.audience,
      roles: n.roles,
      sevas: n.sevas,
      regions: n.regions,
      hotels: n.hotels,
      createdAt: n.createdAt.toISOString(),
      status: scheduled ? "scheduled" : "sent",
      whenLabel: `${formatDayShort(dayKey(n.createdAt))} · ${formatTime(n.createdAt)}`,
      relativeLabel: scheduled ? formatRelative(now, n.createdAt) : null,
      sender: n.createdBy ? greetingName(n.createdBy) : null,
      mine: n.createdById === adminId,
      reach: personal ? people.length : countReach(n, groups),
      audienceLabel: describeAudience(n),
      listed: n.userIds.length,
      people: people.map(toPersonPick),
    };
  };

  if (scope) {
    // Nobody has the filtered sevas yet, so nothing reaches them.
    if (scope.userSevas.length === 0) return { items: [], total: 0 };
    const inScope = scopeGroups(scope, groups);
    // SQL narrows to rows whose seva targeting could include these people; the
    // full rule (roles, track, hotels, regions) runs below, as countReach() everywhere.
    // A personal announcement is always a candidate: its only seva is PERSONAL_MARK, which no
    // one has, and it counts when it lists one of these people (sevaReachOf() below).
    const rows = await findRows({
      where: (people) => ({
        OR: [
          { sevas: { isEmpty: true } },
          { sevas: { hasSome: scope.userSevas } },
          ...(people ? [{ userIds: { isEmpty: false } }] : []),
        ],
      }),
      take: SCOPED_SCAN_LIMIT,
    });
    const byId = await listedPeople(rows);
    const covered = new Set(scope.userSevas);
    // A personal one reaches the people it lists: here, those of them with a filtered seva.
    const sevaReachOf = (n: NotificationRow) =>
      n.userIds.length > 0
        ? n.userIds.filter((id) => {
            const person = byId.get(id);
            return person !== undefined && covered.has(person.rawSeva);
          }).length
        : scopeReach(n, inScope);
    const matches = rows.map((n) => ({ n, sevaReach: sevaReachOf(n) })).filter((m) => m.sevaReach > 0);
    return {
      items: matches.slice(0, HISTORY_LIMIT).map(({ n, sevaReach }) => ({ ...view(n, byId), sevaReach })),
      total: matches.length,
    };
  }

  const [rows, total] = await Promise.all([findRows({ take: HISTORY_LIMIT }), prisma.notification.count()]);
  const byId = await listedPeople(rows);
  return { items: rows.map((n) => view(n, byId)), total };
}
