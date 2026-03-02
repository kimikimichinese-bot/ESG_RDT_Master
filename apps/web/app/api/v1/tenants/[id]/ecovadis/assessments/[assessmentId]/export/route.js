import { ensureEcoVadisSchema } from "../../../../../../_lib/db.js";
import {
  buildEcoVadisDocxBuffer,
  buildEcoVadisExportJson,
  evaluateEcoVadisAssessment,
  sanitizeFilenameForDownload,
} from "../../../../../../_lib/ecovadis-api.js";
import { errorJson, json } from "../../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const assessmentId = params?.assessmentId;

  await ensureEcoVadisSchema();
  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const evaluated = await evaluateEcoVadisAssessment({
    sql: context.sql,
    tenantId,
    assessmentId,
  });

  if (!evaluated) {
    return errorJson("Assessment not found", 404);
  }

  const exportJson = buildEcoVadisExportJson(evaluated);
  const url = new URL(request.url);
  const format = String(url.searchParams.get("format") || "json").toLowerCase();

  if (format === "docx") {
    const buffer = await buildEcoVadisDocxBuffer(exportJson);
    const filename = sanitizeFilenameForDownload(
      `ecovadis-summary-${evaluated.assessment.reportingYear}-${evaluated.assessment.id}.docx`,
      "ecovadis-summary.docx",
    );

    return new Response(buffer, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return json(exportJson);
}
