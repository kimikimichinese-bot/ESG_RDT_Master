import { randomUUID } from "node:crypto";
import { parseYear } from "../../../../_lib/esg-domain.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";
import { logRequest } from "../../../../_lib/observability.js";
import { buildRateLimitKey, consumeRateLimit } from "../../../../_lib/rate-limit.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FACTOR_LIBRARIES = new Set(["IPCC", "DEFRA", "EPA", "CUSTOM"]);
const REQUIRED_HEADERS = ["library", "country", "reporting_year", "key", "unit", "value", "source_label", "source_url"];
const OPTIONAL_HEADERS = [
  "year",
  "scope",
  "scope3_category",
  "method",
  "spend_category",
  "transport_mode",
  "refrigerant_type",
  "region",
  "notes",
];
const VALID_SCOPES = new Set(["scope1", "scope2", "scope3"]);
const VALID_METHODS = new Set(["activity", "spend", "supplier_specific", "direct_tco2e"]);

const getRequestId = (request) =>
  request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (code, message, requestId = null) =>
  json(
    {
      ok: false,
      code,
      message,
      ...(requestId ? { requestId } : {}),
    },
    400,
  );
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const parseCsvLine = (line) => {
  const cells = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(cell);
      cell = "";
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    return { error: "Unbalanced quotes in CSV row" };
  }

  cells.push(cell);
  return { cells: cells.map((item) => item.trim()) };
};

const parseCsv = (rawCsv) => {
  const normalized = String(rawCsv || "").replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { error: "CSV content is empty" };
  }

  const headerRow = parseCsvLine(lines[0]);
  if (headerRow.error) {
    return { error: headerRow.error };
  }

  const headers = headerRow.cells.map((item) => item.toLowerCase());
  for (const header of REQUIRED_HEADERS) {
    if (!headers.includes(header)) {
      return { error: `Missing required CSV column: ${header}` };
    }
  }

  const rows = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const parsedRow = parseCsvLine(lines[lineIndex]);
    if (parsedRow.error) {
      return { error: `Row ${lineIndex + 1}: ${parsedRow.error}` };
    }

    const row = {};
    for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      row[headers[headerIndex]] = parsedRow.cells[headerIndex] ?? "";
    }
    for (const optionalHeader of OPTIONAL_HEADERS) {
      if (!Object.prototype.hasOwnProperty.call(row, optionalHeader)) {
        row[optionalHeader] = "";
      }
    }
    rows.push(row);
  }

  return { rows };
};

const readCsvText = async (request) => {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const upload = form.get("file") || form.get("csvFile");
    if (upload && typeof upload === "object" && typeof upload.text === "function") {
      return upload.text();
    }
    const textField = form.get("csv") || form.get("csvText");
    return typeof textField === "string" ? textField : "";
  }

  if (contentType.includes("application/json")) {
    const payload = await parseJsonBody(request);
    return cleanString(payload.csvText || payload.csv || "");
  }

  return request.text();
};

const normalizeLibrary = (value) => {
  const normalized = cleanString(value).toUpperCase();
  if (!normalized) {
    return null;
  }
  return FACTOR_LIBRARIES.has(normalized) ? normalized : null;
};

const toNullableCountry = (value) => {
  const cleaned = cleanString(value).toUpperCase();
  return cleaned || null;
};

const toNullableYear = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return null;
  }
  return parseYear(cleaned);
};

const toNullableScope3Category = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return null;
  }
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 15) {
    return null;
  }
  return parsed;
};

const toNullableValue = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  let response = null;
  const scoped = await requireTenantContext(request, tenantId, "factors");
  if (scoped.response) {
    response = scoped.response;
    logRequest({ request, response, startedAt, route: "/api/v1/tenants/[id]/factors/import-csv", requestId, extra: { tenantId } });
    return response;
  }

  const { context } = scoped;
  const importLimit = consumeRateLimit({
    key: buildRateLimitKey({ tenantId, routeKey: "factors_import_csv" }),
    limit: 5,
    windowMs: 60_000,
  });
  if (!importLimit.allowed) {
    response = json(
      {
        ok: false,
        code: "rate_limited",
        message: "Too many factor CSV imports. Please retry later.",
        requestId,
        retryAfterSec: importLimit.retryAfterSec,
      },
      429,
    );
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/factors/import-csv",
      requestId,
      extra: { retryAfterSec: importLimit.retryAfterSec },
    });
    return response;
  }

  try {
    const csvText = await readCsvText(request);
    if (!cleanString(csvText)) {
      response = badRequest("missing_csv", "CSV text or file content is required");
      logRequest({
        request,
        response,
        startedAt,
        context: { ...context, tenantId },
        route: "/api/v1/tenants/[id]/factors/import-csv",
        requestId,
      });
      return response;
    }

    const parsed = parseCsv(csvText);
    if (parsed.error) {
      response = badRequest("invalid_csv", parsed.error);
      logRequest({
        request,
        response,
        startedAt,
        context: { ...context, tenantId },
        route: "/api/v1/tenants/[id]/factors/import-csv",
        requestId,
      });
      return response;
    }

    let inserted = 0;
    let updated = 0;

    for (let index = 0; index < parsed.rows.length; index += 1) {
      const rawRow = parsed.rows[index];
      const rowNumber = index + 2;

      const library = normalizeLibrary(rawRow.library);
      if (!library) {
        response = badRequest("invalid_library", `Row ${rowNumber}: library must be one of IPCC/DEFRA/EPA/CUSTOM`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const key = cleanString(rawRow.key);
      if (!key) {
        response = badRequest("missing_key", `Row ${rowNumber}: key is required`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const unit = cleanString(rawRow.unit);
      if (!unit) {
        response = badRequest("missing_unit", `Row ${rowNumber}: unit is required`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const sourceLabel = cleanString(rawRow.source_label);
      if (!sourceLabel) {
        response = badRequest("missing_source_label", `Row ${rowNumber}: source_label is required`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const sourceUrl = cleanString(rawRow.source_url);
      if (!sourceUrl) {
        response = badRequest("missing_source_url", `Row ${rowNumber}: source_url is required`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const country = toNullableCountry(rawRow.country);
      const reportingYearRaw = toNullableYear(rawRow.reporting_year);
      const yearRaw = toNullableYear(rawRow.year);
      const reportingYear = reportingYearRaw ?? yearRaw;
      if ((cleanString(rawRow.reporting_year) || cleanString(rawRow.year)) && !reportingYear) {
        response = badRequest("invalid_reporting_year", `Row ${rowNumber}: reporting_year/year must be a valid year`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const value = toNullableValue(rawRow.value);
      if (Number.isNaN(value)) {
        response = badRequest("invalid_value", `Row ${rowNumber}: value must be numeric or empty`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const scopeRaw = cleanString(rawRow.scope).toLowerCase();
      const scope = scopeRaw || null;
      if (scope && !VALID_SCOPES.has(scope)) {
        response = badRequest("invalid_scope", `Row ${rowNumber}: scope must be scope1/scope2/scope3`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const scope3CategoryRaw = toNullableScope3Category(rawRow.scope3_category);
      if (cleanString(rawRow.scope3_category) && scope3CategoryRaw == null) {
        response = badRequest("invalid_scope3_category", `Row ${rowNumber}: scope3_category must be between 1 and 15`);
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const methodRaw = cleanString(rawRow.method).toLowerCase();
      const method = methodRaw || null;
      if (method && !VALID_METHODS.has(method)) {
        response = badRequest(
          "invalid_method",
          `Row ${rowNumber}: method must be activity/spend/supplier_specific/direct_tco2e`,
        );
        logRequest({
          request,
          response,
          startedAt,
          context: { ...context, tenantId },
          route: "/api/v1/tenants/[id]/factors/import-csv",
          requestId,
        });
        return response;
      }

      const spendCategory = cleanString(rawRow.spend_category) || null;
      const transportMode = cleanString(rawRow.transport_mode) || null;
      const refrigerantType = cleanString(rawRow.refrigerant_type).toUpperCase() || null;
      const region = cleanString(rawRow.region) || null;
      const notes = cleanString(rawRow.notes) || null;
      const countryKey = country || "";
      const reportingYearKey = reportingYear ?? -1;

      const existing = await context.sql`
        SELECT 1
        FROM emission_factor_library
        WHERE library = ${library}
          AND country_key = ${countryKey}
          AND reporting_year_key = ${reportingYearKey}
          AND key = ${key}
        LIMIT 1
      `;

      await context.sql`
        INSERT INTO emission_factor_library (
          library,
          country,
          reporting_year,
          year,
          country_key,
          reporting_year_key,
          key,
          unit,
          value,
          scope,
          scope3_category,
          method,
          spend_category,
          transport_mode,
          refrigerant_type,
          region,
          source_label,
          source_url,
          notes
        )
        VALUES (
          ${library},
          ${country},
          ${reportingYear},
          ${reportingYear},
          ${countryKey},
          ${reportingYearKey},
          ${key},
          ${unit},
          ${value},
          ${scope},
          ${scope3CategoryRaw},
          ${method},
          ${spendCategory},
          ${transportMode},
          ${refrigerantType},
          ${region},
          ${sourceLabel},
          ${sourceUrl},
          ${notes}
        )
        ON CONFLICT (library, country_key, reporting_year_key, key) DO UPDATE
          SET
            country = EXCLUDED.country,
            reporting_year = EXCLUDED.reporting_year,
            year = EXCLUDED.year,
            unit = EXCLUDED.unit,
            value = EXCLUDED.value,
            scope = EXCLUDED.scope,
            scope3_category = EXCLUDED.scope3_category,
            method = EXCLUDED.method,
            spend_category = EXCLUDED.spend_category,
            transport_mode = EXCLUDED.transport_mode,
            refrigerant_type = EXCLUDED.refrigerant_type,
            region = EXCLUDED.region,
            source_label = EXCLUDED.source_label,
            source_url = EXCLUDED.source_url,
            notes = EXCLUDED.notes
      `;

      if (existing?.[0]) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    response = json({
      ok: true,
      inserted,
      updated,
      total: inserted + updated,
    });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/factors/import-csv",
      requestId,
    });
    return response;
  } catch (error) {
    response = serverError(
      requestId,
      "factor_library_import_failed",
      error instanceof Error ? error.message : "Unable to import CSV",
    );
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/factors/import-csv",
      requestId,
    });
    return response;
  }
}
