export function GET() {
  return Response.json({
    status: "ok",
    service: "esg-rdt-master-web",
    timestamp: new Date().toISOString(),
  });
}
