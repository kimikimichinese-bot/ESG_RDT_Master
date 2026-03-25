import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import EnterpriseShell from "./_components/enterprise-shell";
import { buildUnavailableHref } from "../_lib/render-fallback.js";
import { getBootstrapStatus, getServerSessionState } from "../api/v1/_lib/server-auth.js";

export const dynamic = "force-dynamic";

export default async function EnterpriseLayout({ children }) {
  const bootstrap = await getBootstrapStatus({ ensureSchema: false, suppressErrors: true });
  if (bootstrap.unavailable) {
    redirect(
      buildUnavailableHref({
        requestId: bootstrap.renderError?.requestId,
        source: "app-bootstrap",
      }),
    );
  }

  if (bootstrap.needsSetup) {
    redirect("/platform/setup");
  }

  const sessionState = await getServerSessionState(cookies(), { ensureSchema: false, suppressErrors: true });
  if (sessionState.unavailable) {
    redirect(
      buildUnavailableHref({
        requestId: sessionState.renderError?.requestId,
        source: "app-session",
      }),
    );
  }

  if (!sessionState.authenticated) {
    redirect("/login");
  }

  return (
    <EnterpriseShell
      initialUser={sessionState.user}
      initialMemberships={sessionState.memberships}
      initialActiveTenantId={sessionState.activeTenantId}
      initialRole={sessionState.activeMembership?.role || null}
      initialPlatformRole={sessionState.platformRole}
      initialImpersonationReadOnly={sessionState.impersonationReadOnly}
      initialAvailableTenants={sessionState.memberships}
    >
      {children}
    </EnterpriseShell>
  );
}
