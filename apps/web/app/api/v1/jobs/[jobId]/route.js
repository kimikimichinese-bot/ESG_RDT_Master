import { handleJobDetail } from "../../_lib/local-api.js";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const jobId = params?.jobId;
  return handleJobDetail(request, jobId);
}
