import { handleV1Health } from "../_lib/local-api.js";

export const runtime = "nodejs";

export async function GET(request) {
  return handleV1Health(request);
}
