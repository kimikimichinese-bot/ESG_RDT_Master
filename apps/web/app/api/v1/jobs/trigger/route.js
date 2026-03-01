import { handleJobTrigger } from "../../_lib/local-api.js";

export const runtime = "nodejs";

export async function POST(request) {
  return handleJobTrigger(request);
}
