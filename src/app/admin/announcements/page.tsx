import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { LINK_OPTIONS } from "@/lib/admin/announcements";
import { readSevaFilter } from "@/lib/admin/sevaFilter";
import { getSevaOptions } from "@/lib/admin/sevaFilterData";
import { santHref } from "@/components/sant/shell/santNotifications";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { AnnouncementsConsole } from "@/components/admin/announcements/AnnouncementsConsole";
import { sevaScopeFor } from "@/components/admin/announcements/sevaScope";
import { PageHeader } from "@/components/admin/shell/PageHeader";
import { SevaFilter } from "@/components/admin/shell/SevaFilter";
import { getAnnouncementHistory, getFacetGroups } from "./data";

export const metadata: Metadata = { title: "Announcements" };
export const dynamic = "force-dynamic";

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // `now` decides which rows count as sent vs scheduled, so ?now= previews work.
  const { now, traveling, label } = pageNow(sp);
  const admin = await requireAdmin();

  // The console's seva filter (?seva=...) narrows the history to what reached those sevas;
  // the composer and its reach counts always work on everyone.
  const selected = readSevaFilter(sp);
  const [groups, sevaOptions] = await Promise.all([getFacetGroups(), getSevaOptions()]);
  const sevaScope = sevaScopeFor(selected, groups);
  const history = await getAnnouncementHistory(now, admin.id, groups, sevaScope);
  // Links the Pujya Santo view can follow; the composer notes that santos lose the others.
  const santLinks = LINK_OPTIONS.filter((l) => santHref(l.href) !== null).map((l) => l.href);

  return (
    <div className="stagger">
      {traveling && <TimeTravelBanner label={label} />}
      <PageHeader
        title="Announcements"
        description="Post to the notification bell for everyone, or just the people it concerns."
        className="mb-4"
      />
      <div className="mb-5">
        <SevaFilter options={sevaOptions} selected={selected} />
      </div>

      <AnnouncementsConsole
        adminId={admin.id}
        groups={groups}
        history={history.items}
        historyTotal={history.total}
        santLinks={santLinks}
        sevaScope={sevaScope}
      />
    </div>
  );
}
