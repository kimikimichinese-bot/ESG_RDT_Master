import { handleV1Health } from "../v1/_lib/local-api.js";

export async function GET(request) {
  return handleV1Health(request);
}
