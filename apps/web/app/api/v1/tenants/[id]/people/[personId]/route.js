import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizePerson, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

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
  const personId = params?.personId;
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
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

  if (!rows?.[0]) {
    return errorJson("Person not found", 404);
  }

  return json({ person: normalizePerson(rows[0]) });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const personId = params?.personId;
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

  try {
    const updateRows = await context.sql.transaction([
      context.sql`
        UPDATE people
        SET
          site_id = ${primarySiteId},
          full_name = ${fullName},
          email = ${email},
          title = ${cleanString(payload.title) || null},
          updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND id = ${personId}
        RETURNING id
      `,
      context.sql`
        DELETE FROM people_sites
        WHERE tenant_id = ${tenantId} AND person_id = ${personId}
      `,
      ...siteIds.map((siteId) => context.sql`
        INSERT INTO people_sites (tenant_id, person_id, site_id)
        SELECT ${tenantId}, ${personId}, ${siteId}
        WHERE EXISTS (
          SELECT 1
          FROM people
          WHERE tenant_id = ${tenantId} AND id = ${personId}
        )
        ON CONFLICT (tenant_id, person_id, site_id) DO NOTHING
      `),
    ]);

    if (!updateRows?.[0]?.[0]) {
      return errorJson("Person not found", 404);
    }

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
      action: "person.update",
      entityType: "person",
      entityId: personId,
      payload: { fullName, siteIds, primarySiteId },
    });

    return json({ person: normalizePerson(rows[0]) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.toLowerCase().includes("unique")) {
      return errorJson("Email already in use within tenant", 409);
    }
    return errorJson("Failed to update person", 500, { message });
  }
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const personId = params?.personId;
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  const rows = await context.sql`
    DELETE FROM people
    WHERE tenant_id = ${tenantId} AND id = ${personId}
    RETURNING id
  `;

  if (!rows?.[0]) {
    return errorJson("Person not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "person.delete",
    entityType: "person",
    entityId: personId,
    payload: {},
  });

  return json({ ok: true });
}
