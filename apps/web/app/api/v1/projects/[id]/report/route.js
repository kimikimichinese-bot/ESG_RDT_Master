import { getProjectReport } from "../../../_lib/assessment-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  return getProjectReport(request, params?.id);
}
