import { proxyDiagnosticGet } from "../../_lib/diagnostics-proxy.js";

export async function GET(request) {
  return proxyDiagnosticGet(
    request,
    "/v1/status",
    {
      web: "warn",
      tenantScope: "warn",
      eventStore: "warn",
      calculationEngine: "warn",
    },
    "/v1/status",
  );
}
