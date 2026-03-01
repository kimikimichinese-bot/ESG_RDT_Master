import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import EnterpriseShell from "./_components/enterprise-shell";
import { getBootstrapStatus, getServerSessionState } from "../api/v1/_lib/server-auth.js";

export const dynamic = "force-dynamic";

export default async function EnterpriseLayout({ children }) {
  const bootstrap = await getBootstrapStatus();
  if (bootstrap.needsSetup) {
    redirect("/setup");
  }

  const sessionState = await getServerSessionState(cookies());
  if (!sessionState.authenticated) {
    redirect("/login");
  }

  return (
    <EnterpriseShell
      initialUser={sessionState.user}
      initialMemberships={sessionState.memberships}
      initialActiveTenantId={sessionState.activeTenantId}
      initialRole={sessionState.activeMembership?.role || null}
    >
      {children}
    </EnterpriseShell>
  );
}
