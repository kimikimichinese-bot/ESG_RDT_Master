import { proxyDiagnosticGet } from "../_lib/diagnostics-proxy.js";

export async function GET(request) {
  return proxyDiagnosticGet(
    request,
    "/health",
    { web: "warn", db: "down" },
    "/health",
  );
}
