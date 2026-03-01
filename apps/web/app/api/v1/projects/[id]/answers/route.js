import { getProjectAnswers, upsertProjectAnswers } from "../../../_lib/assessment-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  return getProjectAnswers(request, params?.id);
}

export async function PUT(request, { params }) {
  return upsertProjectAnswers(request, params?.id);
}
