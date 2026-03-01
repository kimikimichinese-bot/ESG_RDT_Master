import { buildSessionCookie } from "../../_lib/auth.js";
import { requireAuthContext } from "../../_lib/enterprise-api.js";
import { errorJson, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const buildMePayload = (context, activeTenantId) => {
  const activeMembership = context.memberships.find((item) => item.tenantId === activeTenantId) || null;
  return {
    authenticated: true,
    user: context.user,
    memberships: context.memberships,
    activeTenantId,
    activeRole: activeMembership?.role || null,
  };
};

export async function GET(request) {
  const auth = await requireAuthContext(request);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const needsCookieRefresh = context.activeTenantId !== context.session.activeTenantId;

  const response = new Response(JSON.stringify(buildMePayload(context, context.activeTenantId)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

  if (needsCookieRefresh) {
    response.headers.set(
      "set-cookie",
      buildSessionCookie({ userId: context.user.id, activeTenantId: context.activeTenantId }),
    );
  }

  return response;
}

export async function PUT(request) {
  const auth = await requireAuthContext(request);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const payload = await parseJsonBody(request);
  const nextTenantId = typeof payload.activeTenantId === "string" ? payload.activeTenantId : "";

  const membership = context.memberships.find((item) => item.tenantId === nextTenantId) || null;
  if (!membership) {
    return errorJson("Tenant not available for current user", 403);
  }

  return new Response(JSON.stringify(buildMePayload(context, membership.tenantId)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": buildSessionCookie({
        userId: context.user.id,
        activeTenantId: membership.tenantId,
      }),
    },
  });
}
