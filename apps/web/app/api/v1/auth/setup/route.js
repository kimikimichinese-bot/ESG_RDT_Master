import { randomUUID } from "node:crypto";
import { buildSessionCookie, createTenantAndAdmin, issueSessionForUser } from "../../_lib/auth.js";
import { errorJson, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request) {
  try {
    const payload = await parseJsonBody(request);
    const result = await createTenantAndAdmin({
      tenantName: payload.tenantName,
      email: payload.email,
      name: payload.name,
      password: payload.password,
    });

    if (result.error) {
      const extra = result.code ? { code: result.code } : {};
      return errorJson(result.error, result.status || 400, extra);
    }

    const session = await issueSessionForUser(result.userId, result.tenantId);
    if (!session) {
      return errorJson("Failed to bootstrap session", 500);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user: session.user,
        memberships: session.memberships,
        activeTenantId: session.activeTenantId,
      }),
      {
        status: 201,
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
    const requestId = randomUUID();
    return errorJson("Failed to complete setup", 500, {
      message: error instanceof Error ? error.message : "Unexpected error",
      requestId,
    });
  }
}
