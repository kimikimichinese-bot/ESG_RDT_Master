import { proxyDiagnosticGet } from "../../_lib/diagnostics-proxy.js";

export async function GET(request) {
  return proxyDiagnosticGet(
    request,
    "/v1/health",
    { web: "warn", db: "down" },
    "/v1/health",
  );
}
