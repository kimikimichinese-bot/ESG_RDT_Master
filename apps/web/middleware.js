import { NextResponse } from "next/server";

const CANONICAL_HOST = "esg-rdt-master-pi.vercel.app";

export function middleware(request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.next();
  }

  const hostHeader = request.headers.get("host") || "";
  const requestHost = hostHeader.toLowerCase().split(":")[0];

  if (requestHost && requestHost !== CANONICAL_HOST) {
    const redirectUrl = new URL(request.url);
    redirectUrl.protocol = "https:";
    redirectUrl.host = CANONICAL_HOST;
    return NextResponse.redirect(redirectUrl, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|robots.txt|sitemap.xml).*)"],
};
