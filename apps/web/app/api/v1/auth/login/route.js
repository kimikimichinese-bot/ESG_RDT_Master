import { randomUUID } from "node:crypto";
import { authenticateWithPassword, buildSessionCookie, issueSessionForUser } from "../../_lib/auth.js";
import { getBootstrapMetrics } from "../../_lib/server-auth.js";
import { errorJson, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request) {
  try {
    const bootstrap = await getBootstrapMetrics();
    if (bootstrap.superadminsCount === 0) {
      return errorJson("Setup required", 409, {
        needsSetup: true,
        superadminsCount: bootstrap.superadminsCount,
      });
    }

    const payload = await parseJsonBody(request);
    const auth = await authenticateWithPassword({
      email: payload.email,
      password: payload.password,
    });

    if (auth.error) {
      return errorJson(auth.error, auth.status || 401, auth.code ? { code: auth.code } : {});
    }

    const session = await issueSessionForUser(auth.userId, auth.activeTenantId);
    if (!session) {
      return errorJson("Failed to issue session", 500);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user: session.user,
        platformRole: session.platformRole,
        memberships: session.memberships,
        activeTenantId: session.activeTenantId,
        impersonationReadOnly: session.impersonationReadOnly,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": buildSessionCookie({
            userId: session.user.id,
            activeTenantId: session.activeTenantId,
            impersonationReadOnly: session.impersonationReadOnly,
          }),
        },
      },
    );
  } catch (error) {
    const requestId = randomUUID();
    return errorJson("Login failed", 500, {
      message: error instanceof Error ? error.message : "Unexpected error",
      requestId,
    });
  }
}
