import { authenticateWithPassword, buildSessionCookie, issueSessionForUser } from "../../_lib/auth.js";
import { getBootstrapStatus } from "../../_lib/server-auth.js";
import { errorJson, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request) {
  try {
    const bootstrap = await getBootstrapStatus();
    if (bootstrap.needsSetup) {
      return errorJson("Setup required", 409);
    }

    const payload = await parseJsonBody(request);
    const auth = await authenticateWithPassword({
      email: payload.email,
      password: payload.password,
    });

    if (auth.error) {
      return errorJson(auth.error, auth.status || 401);
    }

    const session = await issueSessionForUser(auth.userId, auth.activeTenantId);
    if (!session) {
      return errorJson("Failed to issue session", 500);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user: session.user,
        memberships: session.memberships,
        activeTenantId: session.activeTenantId,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": buildSessionCookie({
            userId: session.user.id,
            activeTenantId: session.activeTenantId,
          }),
        },
      },
    );
  } catch (error) {
    return errorJson("Login failed", 500, {
      message: error instanceof Error ? error.message : "Unexpected error",
    });
  }
}
