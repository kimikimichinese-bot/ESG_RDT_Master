import { randomUUID } from "node:crypto";
import { bootstrapPlatformSuperadmin, buildSessionCookie, issueSessionForUser } from "../../_lib/auth.js";
import { errorJson, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request) {
  try {
    const payload = await parseJsonBody(request);
    const result = await bootstrapPlatformSuperadmin({
      ownerName: payload.ownerName,
      email: payload.email,
      name: payload.name,
      password: payload.password,
    });

    if (result.error) {
      return errorJson(result.error, result.status || 400, result.code ? { code: result.code } : {});
    }

    const session = await issueSessionForUser(result.userId, null, { readOnly: false });
    if (!session) {
      return errorJson("Failed to create session after bootstrap", 500);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        redirectTo: "/app/superadmin",
        user: session.user,
        platformRole: session.platformRole,
        activeTenantId: session.activeTenantId,
        impersonationReadOnly: session.impersonationReadOnly,
      }),
      {
        status: 201,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": buildSessionCookie({
            userId: session.user.id,
            activeTenantId: session.activeTenantId,
            impersonationReadOnly: false,
          }),
        },
      },
    );
  } catch (error) {
    return errorJson("Failed to bootstrap platform", 500, {
      requestId: randomUUID(),
      message: error instanceof Error ? error.message : "Unexpected error",
    });
  }
}
