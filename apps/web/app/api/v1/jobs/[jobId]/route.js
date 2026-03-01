import { getJobById } from "../../_lib/local-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const jobId = params?.jobId;
  return getJobById(request, jobId);
}
