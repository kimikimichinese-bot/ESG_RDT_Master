import { buildClearSessionCookie } from "../../_lib/auth.js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": buildClearSessionCookie(),
    },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const redirectToParam = url.searchParams.get("redirectTo");
  const redirectTo = typeof redirectToParam === "string" && redirectToParam.startsWith("/") ? redirectToParam : "/login";
  const response = NextResponse.redirect(new URL(redirectTo, url.origin), { status: 303 });
  response.headers.set("cache-control", "no-store");
  response.headers.set("set-cookie", buildClearSessionCookie());
  return response;
}
