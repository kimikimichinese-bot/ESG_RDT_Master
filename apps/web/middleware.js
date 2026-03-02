import { NextResponse } from "next/server";

const getCanonicalHost = () => {
  const explicit = process.env.CANONICAL_HOST;
  if (explicit && explicit.trim()) {
    return explicit.trim().toLowerCase();
  }

  const fallback = process.env.APP_CANONICAL_HOST;
  if (fallback && fallback.trim()) {
    return fallback.trim().toLowerCase();
  }

  return "";
};

export function middleware(request) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const canonicalHost = getCanonicalHost();
  if (!canonicalHost) {
    return NextResponse.next();
  }

  const incomingHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
    .split(":")[0]
    .toLowerCase();

  if (!incomingHost || incomingHost === canonicalHost) {
    return NextResponse.next();
  }

  const nextUrl = request.nextUrl.clone();
  nextUrl.host = canonicalHost;
  nextUrl.protocol = "https:";

  return NextResponse.redirect(nextUrl, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
