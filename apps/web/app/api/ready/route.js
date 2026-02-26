import { proxyDiagnosticGet } from "../_lib/diagnostics-proxy.js";

export async function GET(request) {
  return proxyDiagnosticGet(
    request,
    "/ready",
    { web: "warn" },
    "/ready",
  );
}
