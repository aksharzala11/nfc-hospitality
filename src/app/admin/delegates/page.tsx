import type { Metadata } from "next";
import { mirrorTestersEnabled, requireAdmin } from "@/lib/auth";
import { getDirectoryPeople } from "@/lib/admin/delegates";
import { getOpenBounceNotes } from "@/lib/admin/emailEvents";
import { DelegateDirectory } from "@/components/admin/delegates/DelegateDirectory";

export const metadata: Metadata = { title: "Delegates" };
export const dynamic = "force-dynamic";

/**
 * Admin delegate directory: everyone who can sign in (delegates, santos and
 * admins). The whole list (~800) is sent once as safe, plain rows
 * (DirectoryPerson: no test codes); search, filters, sort and paging run in
 * the browser and live in the URL (?q=, ?role=, ?seva=, ?status=, ?sort=,
 * ?new=1 opens the add form, ?person=BAPSID a person). A person whose email
 * has an open bounce (/admin/bounces) gets an "Email bounced" note under it.
 */
export default async function AdminDelegatesPage() {
  // The layout checks too, but layouts don't re-run on every navigation.
  const admin = await requireAdmin();
  const [people, bounces] = await Promise.all([getDirectoryPeople(), getOpenBounceNotes()]);

  return (
    <div className="stagger">
      <DelegateDirectory
        people={people}
        viewerId={admin.id}
        serverNow={new Date().toISOString()}
        mirrorsEnabled={mirrorTestersEnabled()}
        bounces={bounces}
      />
    </div>
  );
}
