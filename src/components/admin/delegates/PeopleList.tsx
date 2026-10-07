"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { DirectoryPerson } from "@/lib/admin/delegates";
import {
  formatDate,
  formatStamp,
  searchHitsRegistrationId,
  sevaRoleNote,
  sortLabel,
  timeAgo,
  type Sort,
  type SortKey,
} from "./directory";
import { Avatar, MirrorChip, RoleBadge, SignInDot } from "./ui";

type ListProps = {
  people: readonly DirectoryPerson[];
  /** The current search: phone cards show a registration ID only when it is being searched for. */
  query: string;
  sort: Sort;
  onSort: (key: SortKey) => void;
  onOpen: (id: string) => void;
  /** Row to flash after a save. */
  highlightId: string | null;
  viewerId: string;
  now: number;
};

const FLASH = "bg-coral-100/80";

/**
 * The visible slice of the directory: compact cards on phones, a table with
 * sortable headers from md up. Both carry `data-person-id` on their focusable
 * element so the directory can scroll to and focus a saved person.
 */
export function PeopleList(props: ListProps) {
  return (
    <>
      <PeopleCards {...props} />
      <PeopleTable {...props} />
    </>
  );
}

/** The master list's raw seva after the team code, where it adds something: "YM RC (NA RC Lead)". */
function SevaRole({ person }: { person: DirectoryPerson }) {
  const note = sevaRoleNote(person);
  return note ? <span className="text-ink-500"> ({note})</span> : null;
}

/** Table cell: the team, with the raw seva role underneath when it differs. */
function SevaCell({ person }: { person: DirectoryPerson }) {
  const note = sevaRoleNote(person);
  return (
    <td className="px-3 text-ink-700" title={note ? `${person.seva} (${note})` : person.seva}>
      <p className="truncate">{person.seva}</p>
      {note && <p className="truncate text-xs text-ink-500">{note}</p>}
    </td>
  );
}

function PeopleCards({ people, query, onOpen, highlightId, viewerId, now }: ListProps) {
  return (
    <ul className="card divide-y divide-ink-800/8 overflow-hidden md:hidden">
      {people.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            data-person-id={p.id}
            onClick={() => onOpen(p.id)}
            className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-700 hover:bg-sand-100/60 focus-visible:bg-sand-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral-600 motion-reduce:transition-none ${
              highlightId === p.id ? FLASH : ""
            }`}
          >
            <Avatar person={p} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                <span className="font-semibold text-ink-900">{p.name}</span>
                {p.displayName && <span className="text-ink-500"> · {p.displayName}</span>}
                {p.id === viewerId && <span className="text-ink-500"> (you)</span>}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-600">
                <span className="font-semibold text-ink-700">{p.bapsId}</span>
                {p.registrationId && searchHitsRegistrationId(p, query) && ` · Reg. ID ${p.registrationId}`}
                {` · ${p.seva}`}
                <SevaRole person={p} />
                {p.region ? ` · ${p.region}` : ""}
              </span>
              {p.mirrorRegistrationId && (
                <span className="mt-1 block">
                  <MirrorChip registrationId={p.mirrorRegistrationId} role={p.role} />
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-2">
              <RoleBadge role={p.role} />
              <SignInDot at={p.lastSignInAt} now={now} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const TH = "px-3 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500";

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={`${TH} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`group -mx-1 inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 uppercase tracking-[0.12em] transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral-600 ${
          active ? "text-ink-900" : ""
        }`}
      >
        {label}
        <Icon
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 ${active ? "" : "opacity-0 transition group-hover:opacity-50 group-focus-visible:opacity-50"}`}
        />
      </button>
    </th>
  );
}

function PeopleTable({ people, sort, onSort, onOpen, highlightId, viewerId, now }: ListProps) {
  const header = { sort, onSort };
  return (
    <div className="card hidden overflow-hidden md:block">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">People, sorted by {sortLabel(sort)}. Select a name to see their details.</caption>
        <thead className="border-b border-ink-800/8 bg-sand-100/70">
          <tr>
            <SortHeader label="Name" column="name" {...header} className="pl-5" />
            <SortHeader label="BAPS ID" column="bapsId" {...header} className="w-28" />
            <SortHeader label="Seva" column="seva" {...header} className="w-32" />
            <SortHeader label="Region" column="region" {...header} className="w-24" />
            <th scope="col" className="w-24 px-2 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500">
              Role
            </th>
            <SortHeader label="Signed in" column="signin" {...header} className="w-28" />
            <SortHeader label="Added" column="added" {...header} className="hidden w-28 lg:table-cell" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800/8">
          {people.map((p) => (
            <tr
              key={p.id}
              onClick={() => onOpen(p.id)}
              className={`cursor-pointer transition-colors duration-700 hover:bg-sand-100/60 has-[:focus-visible]:bg-sand-100/80 motion-reduce:transition-none ${
                highlightId === p.id ? FLASH : ""
              }`}
            >
              <td className="py-2.5 pl-5 pr-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="hidden lg:flex">
                    <Avatar person={p} size="sm" />
                  </span>
                  <div className="min-w-0">
                    <button
                      type="button"
                      data-person-id={p.id}
                      className="block max-w-full truncate rounded-sm text-left font-semibold text-ink-900 underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:decoration-coral-600 focus-visible:decoration-2 focus-visible:ring-2 focus-visible:ring-coral-600 focus-visible:ring-offset-2"
                    >
                      {p.name}
                      {p.id === viewerId && <span className="font-normal text-ink-500"> (you)</span>}
                    </button>
                    {p.displayName && <p className="truncate text-xs text-ink-500">{p.displayName}</p>}
                    {p.mirrorRegistrationId && (
                      <p className="mt-1">
                        <MirrorChip registrationId={p.mirrorRegistrationId} role={p.role} />
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td
                className="px-3 text-ink-700"
                title={p.registrationId ? `${p.bapsId} · Registration ID ${p.registrationId}` : p.bapsId}
              >
                <p className="truncate font-medium">{p.bapsId}</p>
                {p.registrationId && <p className="truncate text-xs text-ink-500">Reg. ID {p.registrationId}</p>}
              </td>
              <SevaCell person={p} />
              <td className="truncate px-3 text-ink-700" title={p.region ?? undefined}>
                {p.region ?? <span className="text-ink-400">—</span>}
              </td>
              <td className="px-2">
                <RoleBadge role={p.role} />
              </td>
              <td className="px-3">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <SignInDot at={p.lastSignInAt} now={now} decorative />
                  {p.lastSignInAt ? (
                    <span className="truncate text-ink-700" title={formatStamp(p.lastSignInAt)}>
                      {timeAgo(p.lastSignInAt, now)}
                    </span>
                  ) : (
                    <span className="text-ink-500">Never</span>
                  )}
                </span>
              </td>
              <td className="hidden truncate px-3 text-ink-600 lg:table-cell">{formatDate(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
