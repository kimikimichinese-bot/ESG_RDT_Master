export function GET() {
  return Response.json({
    status: "ready",
    service: "esg-rdt-master-web",
    timestamp: new Date().toISOString(),
    checks: {
      web: "ok",
    },
  });
}
