import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { normalizePerson, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseRequestedSiteIds = (payload) => {
  if (Array.isArray(payload.siteIds)) {
    return payload.siteIds
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0)
      .filter((item, index, source) => source.indexOf(item) === index);
  }

  const legacySiteId = cleanString(payload.siteId);
  return legacySiteId ? [legacySiteId] : [];
};

const resolveSiteIds = async (sql, tenantId, payload) => {
  const requestedSiteIds = parseRequestedSiteIds(payload);
  if (requestedSiteIds.length === 0) {
    return { siteIds: [], invalidSiteIds: [] };
  }

  const resolved = [];
  const invalid = [];
  for (const siteId of requestedSiteIds) {
    const rows = await sql`
      SELECT id
      FROM sites
      WHERE id = ${siteId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    if (rows?.[0]?.id) {
      resolved.push(rows[0].id);
    } else {
      invalid.push(siteId);
    }
  }

  return {
    siteIds: resolved,
    invalidSiteIds: invalid,
  };
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const { limit } = parsePagination(request, { limit: 200, max: 500 });
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const siteId = cleanString(url.searchParams.get("siteId"));

  const rows = await context.sql`
    WITH base_people AS (
      SELECT p.id, p.tenant_id, p.site_id, p.full_name, p.email, p.title, p.created_at, p.updated_at
      FROM people p
      LEFT JOIN sites s ON s.id = p.site_id
      WHERE p.tenant_id = ${tenantId}
        AND (${siteId} = '' OR p.site_id = ${siteId})
        AND (${companyId} = '' OR s.company_id = ${companyId})
      ORDER BY p.created_at DESC
      LIMIT ${limit}
    )
    SELECT
      p.id,
      p.tenant_id,
      p.site_id,
      p.full_name,
      p.email,
      p.title,
      p.created_at,
      p.updated_at,
      COALESCE(
        ARRAY_AGG(ps.site_id ORDER BY ps.site_id) FILTER (WHERE ps.site_id IS NOT NULL),
        ARRAY[]::uuid[]
      ) AS site_ids
    FROM base_people p
    LEFT JOIN people_sites ps
      ON ps.tenant_id = p.tenant_id
      AND ps.person_id = p.id
    GROUP BY p.id, p.tenant_id, p.site_id, p.full_name, p.email, p.title, p.created_at, p.updated_at
    ORDER BY p.created_at DESC
  `;

  return json({ people: rows.map((row) => normalizePerson(row)) });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const fullName = cleanString(payload.fullName);

  if (!fullName) {
    return errorJson("fullName is required", 400);
  }

  const { siteIds, invalidSiteIds } = await resolveSiteIds(context.sql, tenantId, payload);
  if (invalidSiteIds.length > 0) {
    return errorJson("One or more siteIds are invalid for this tenant", 400, { invalidSiteIds });
  }

  const primarySiteId = siteIds[0] || null;
  const email = cleanString(payload.email).toLowerCase() || null;
  const personId = randomUUID();

  try {
    const queries = [
      context.sql`
        INSERT INTO people (id, tenant_id, site_id, full_name, email, title)
        VALUES (${personId}, ${tenantId}, ${primarySiteId}, ${fullName}, ${email}, ${cleanString(payload.title) || null})
        RETURNING id
      `,
      ...siteIds.map((siteId) => context.sql`
        INSERT INTO people_sites (tenant_id, person_id, site_id)
        VALUES (${tenantId}, ${personId}, ${siteId})
        ON CONFLICT (tenant_id, person_id, site_id) DO NOTHING
      `),
    ];
    await context.sql.transaction(queries);

    const rows = await context.sql`
      SELECT
        p.id,
        p.tenant_id,
        p.site_id,
        p.full_name,
        p.email,
        p.title,
        p.created_at,
        p.updated_at,
        COALESCE(
          ARRAY_AGG(ps.site_id ORDER BY ps.site_id) FILTER (WHERE ps.site_id IS NOT NULL),
          ARRAY[]::uuid[]
        ) AS site_ids
      FROM people p
      LEFT JOIN people_sites ps
        ON ps.tenant_id = p.tenant_id
        AND ps.person_id = p.id
      WHERE p.tenant_id = ${tenantId} AND p.id = ${personId}
      GROUP BY p.id, p.tenant_id, p.site_id, p.full_name, p.email, p.title, p.created_at, p.updated_at
      LIMIT 1
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "person.create",
      entityType: "person",
      entityId: personId,
      payload: { fullName, siteIds, primarySiteId },
    });

    return json({ person: normalizePerson(rows[0]) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.toLowerCase().includes("unique")) {
      return errorJson("Email already in use within tenant", 409);
    }
    return errorJson("Failed to create person", 500, { message });
  }
}
