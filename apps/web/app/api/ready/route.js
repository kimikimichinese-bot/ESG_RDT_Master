import { handleV1Status } from "../v1/_lib/local-api.js";

export async function GET(request) {
  return handleV1Status(request);
}
