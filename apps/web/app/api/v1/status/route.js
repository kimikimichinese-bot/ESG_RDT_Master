import { handleV1Status } from "../_lib/local-api.js";

export const runtime = "nodejs";

export async function GET(request) {
  return handleV1Status(request);
}
