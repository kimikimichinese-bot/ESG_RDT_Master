import { randomUUID } from "node:crypto";
import { getBootstrapMetrics } from "../../_lib/server-auth.js";
import { json } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { usersCount, superadminsCount, tenantsCount, membershipsCount } = await getBootstrapMetrics();
    return json({
      ok: true,
      usersCount,
      superadminsCount,
      tenantsCount,
      membershipsCount,
      needsPlatformSetup: superadminsCount === 0,
    });
  } catch (error) {
    const requestId = randomUUID();
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to read bootstrap status",
        requestId,
      },
      500,
    );
  }
}
