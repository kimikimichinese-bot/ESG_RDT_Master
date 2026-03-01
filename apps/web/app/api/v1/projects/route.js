import { createProject, listProjects } from "../_lib/assessment-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return listProjects();
}

export async function POST(request) {
  return createProject(request);
}
