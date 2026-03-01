import { processQueuedJobsTick } from "../../_lib/local-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const unauthorized = (message, status) =>
  new Response(
    JSON.stringify({
      error: message,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );

export async function GET(request) {
  const configured = process.env.CRON_SECRET;
  if (!configured || !configured.trim()) {
    return unauthorized("Missing CRON_SECRET configuration", 500);
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return unauthorized("Missing Authorization header", 401);
  }

  if (authHeader !== `Bearer ${configured}`) {
    return unauthorized("Invalid CRON_SECRET", 403);
  }

  const summary = await processQueuedJobsTick();
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
