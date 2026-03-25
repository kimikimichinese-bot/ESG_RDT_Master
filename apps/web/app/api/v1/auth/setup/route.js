import { json } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request) {
  return json(
    {
      error: "Deprecated endpoint. Use /api/v1/platform/bootstrap instead.",
      code: "DEPRECATED_SETUP_ENDPOINT",
      setupPath: "/platform/setup",
    },
    410,
  );
}
