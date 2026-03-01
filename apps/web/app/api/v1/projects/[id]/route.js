import { getProjectDetail, updateProject } from "../../_lib/assessment-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  return getProjectDetail(request, params?.id);
}

export async function PUT(request, { params }) {
  return updateProject(request, params?.id);
}
