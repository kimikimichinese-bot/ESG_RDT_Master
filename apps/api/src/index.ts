import { createServer } from "node:http";
import { randomUUID } from "crypto";

const PORT = Number(process.env.PORT ?? "3001");
const TENANT_HEADER = "x-tenant-id";

const json = (body: unknown) => JSON.stringify(body);

const requestId = () => randomUUID();

const server = createServer((req, res) => {
  const headers = { "content-type": "application/json; charset=utf-8" };
  const tenantId = req.headers[TENANT_HEADER] ?? null;

  if (req.url === "/health") {
    const payload = {
      service: "esg-rdt-master-api",
      status: "ok",
      tenantHeader: tenantId,
      version: "0.1.0",
    };
    res.writeHead(200, headers);
    res.end(json(payload));
    return;
  }

  if (req.url === "/v1/status") {
    const payload = {
      ready: true,
      workerReady: true,
      checks: ["tenant-scope", "event-store", "calculation-engine"],
    };
    res.writeHead(200, headers);
    res.end(json(payload));
    return;
  }

  res.writeHead(404, {
    ...headers,
    "x-request-id": requestId(),
  });
  res.end(json({ error: "not found", path: req.url }));
});

server.listen(PORT, () => {
  console.log(`ESG API placeholder started. listening on :${PORT}`);
});
