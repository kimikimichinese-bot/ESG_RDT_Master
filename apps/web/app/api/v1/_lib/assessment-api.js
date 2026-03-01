import { randomUUID } from "node:crypto";
import { ensureAssessmentSchema, getSql } from "./db.js";
import { json, parseJsonBody } from "./http.js";
import { requireAuthContext } from "./enterprise-api.js";
import { canAccessResource } from "./rbac.js";
import { writeAuditLog } from "./audit.js";

const parseJsonColumn = (value) => {
  if (value == null) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return value;
    }
  }
  return value;
};

const toIso = (value) => {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
};

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const isMeaningfulValue = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
};

const normalizeProject = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  siteId: row.site_id,
  name: row.name,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  answerCount: Number(row.answer_count ?? 0),
});

const normalizeParameter = (row) => ({
  key: row.key,
  category: row.category,
  label: row.label,
  description: row.description,
  type: row.type,
  required: Boolean(row.required),
  options: parseJsonColumn(row.options),
  sortOrder: Number(row.sort_order ?? 0),
});

const normalizeAnswer = (row) => ({
  projectId: row.project_id,
  tenantId: row.tenant_id,
  parameterKey: row.parameter_key,
  value: parseJsonColumn(row.value),
  updatedAt: toIso(row.updated_at),
});

const getTenantContextOrResponse = async (request) => {
  const auth = await requireAuthContext(request);
  if (auth.response) {
    return { response: auth.response };
  }

  const { context } = auth;
  const membership = context.memberships.find((item) => item.tenantId === context.activeTenantId) || null;
  if (!membership) {
    return {
      response: json(
        {
          error: "No active tenant membership",
        },
        403,
      ),
    };
  }

  return {
    context: {
      ...context,
      role: membership.role,
      tenantId: context.activeTenantId,
    },
  };
};

const canMutateAssessments = (role) => canAccessResource(role, "assessments", "POST");

const getProjectById = async (sql, tenantId, projectId) => {
  const rows = await sql`
    SELECT id, tenant_id, site_id, name, created_at, updated_at
    FROM projects
    WHERE id = ${projectId} AND tenant_id = ${tenantId}
    LIMIT 1
  `;
  return rows?.[0] ?? null;
};

const getParameters = async (sql) => {
  const rows = await sql`
    SELECT key, category, label, description, type, required, options, sort_order
    FROM parameters
    ORDER BY category ASC, sort_order ASC, key ASC
  `;
  return rows.map((row) => normalizeParameter(row));
};

const getAnswersByProjectId = async (sql, tenantId, projectId) => {
  const rows = await sql`
    SELECT project_id, tenant_id, parameter_key, value, updated_at
    FROM answers
    WHERE project_id = ${projectId} AND tenant_id = ${tenantId}
    ORDER BY parameter_key ASC
  `;

  return rows.map((row) => normalizeAnswer(row));
};

const normalizeAnswerEntries = (payloadAnswers) => {
  if (Array.isArray(payloadAnswers)) {
    return payloadAnswers
      .filter((item) => isPlainObject(item) && typeof item.parameterKey === "string")
      .map((item) => ({ parameterKey: item.parameterKey.trim(), value: item.value }));
  }

  if (isPlainObject(payloadAnswers)) {
    return Object.entries(payloadAnswers)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, value]) => ({ parameterKey: key.trim(), value }));
  }

  return [];
};

const parseNullableSiteId = async (sql, tenantId, siteId) => {
  if (!siteId || typeof siteId !== "string") {
    return null;
  }

  const rows = await sql`
    SELECT id
    FROM sites
    WHERE id = ${siteId} AND tenant_id = ${tenantId}
    LIMIT 1
  `;

  return rows?.[0]?.id || null;
};

export const listProjects = async (request) => {
  try {
    await ensureAssessmentSchema();
    const auth = await getTenantContextOrResponse(request);
    if (auth.response) {
      return auth.response;
    }

    const { tenantId } = auth.context;
    const sql = getSql();

    const rows = await sql`
      SELECT
        p.id,
        p.tenant_id,
        p.site_id,
        p.name,
        p.created_at,
        p.updated_at,
        COALESCE(a.answer_count, 0)::int AS answer_count
      FROM projects p
      LEFT JOIN (
        SELECT project_id, tenant_id, COUNT(*)::int AS answer_count, MAX(updated_at) AS last_answer_at
        FROM answers
        WHERE tenant_id = ${tenantId}
        GROUP BY project_id, tenant_id
      ) a ON a.project_id = p.id AND a.tenant_id = p.tenant_id
      WHERE p.tenant_id = ${tenantId}
      ORDER BY GREATEST(p.updated_at, COALESCE(a.last_answer_at, p.updated_at)) DESC
    `;

    return json({ projects: rows.map((row) => normalizeProject(row)) });
  } catch (error) {
    return json(
      {
        error: "Failed to list projects",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
};

export const createProject = async (request) => {
  try {
    await ensureAssessmentSchema();
    const auth = await getTenantContextOrResponse(request);
    if (auth.response) {
      return auth.response;
    }

    const { tenantId, role, user } = auth.context;
    if (!canMutateAssessments(role)) {
      return json({ error: "Forbidden by role policy" }, 403);
    }

    const sql = getSql();
    const payload = await parseJsonBody(request);
    const rawName = typeof payload.name === "string" ? payload.name.trim() : "";

    const projectId = randomUUID();
    const defaultDate = new Date().toISOString().slice(0, 10);
    const name = rawName || `Assessment ${defaultDate}`;
    const siteId = await parseNullableSiteId(sql, tenantId, payload.siteId);

    const rows = await sql`
      INSERT INTO projects (id, tenant_id, site_id, name)
      VALUES (${projectId}, ${tenantId}, ${siteId}, ${name})
      RETURNING id, tenant_id, site_id, name, created_at, updated_at
    `;

    await writeAuditLog(sql, {
      tenantId,
      actorUserId: user.id,
      action: "project.create",
      entityType: "project",
      entityId: projectId,
      payload: { name, siteId },
    });

    return json({ project: normalizeProject({ ...rows[0], answer_count: 0 }) }, 201);
  } catch (error) {
    return json(
      {
        error: "Failed to create project",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
};

export const getProjectDetail = async (request, projectId) => {
  try {
    await ensureAssessmentSchema();
    const auth = await getTenantContextOrResponse(request);
    if (auth.response) {
      return auth.response;
    }

    const { tenantId } = auth.context;
    const sql = getSql();

    const projectRow = await getProjectById(sql, tenantId, projectId);
    if (!projectRow) {
      return json({ error: "Project not found" }, 404);
    }

    const [parameters, answers] = await Promise.all([
      getParameters(sql),
      getAnswersByProjectId(sql, tenantId, projectId),
    ]);

    const answerMap = Object.fromEntries(answers.map((item) => [item.parameterKey, item.value]));

    return json({
      project: normalizeProject({ ...projectRow, answer_count: answers.length }),
      parameters,
      answers,
      answerMap,
    });
  } catch (error) {
    return json(
      {
        error: "Failed to load project",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
};

export const updateProject = async (request, projectId) => {
  try {
    await ensureAssessmentSchema();
    const auth = await getTenantContextOrResponse(request);
    if (auth.response) {
      return auth.response;
    }

    const { tenantId, role, user } = auth.context;
    if (!canMutateAssessments(role)) {
      return json({ error: "Forbidden by role policy" }, 403);
    }

    const sql = getSql();
    const payload = await parseJsonBody(request);
    const name = typeof payload.name === "string" ? payload.name.trim() : "";

    if (!name) {
      return json({ error: "Project name is required" }, 400);
    }

    const siteId = await parseNullableSiteId(sql, tenantId, payload.siteId);

    const rows = await sql`
      UPDATE projects
      SET name = ${name}, site_id = ${siteId}, updated_at = NOW()
      WHERE id = ${projectId} AND tenant_id = ${tenantId}
      RETURNING id, tenant_id, site_id, name, created_at, updated_at
    `;

    if (!rows?.[0]) {
      return json({ error: "Project not found" }, 404);
    }

    await writeAuditLog(sql, {
      tenantId,
      actorUserId: user.id,
      action: "project.update",
      entityType: "project",
      entityId: projectId,
      payload: { name, siteId },
    });

    return json({ project: normalizeProject({ ...rows[0], answer_count: 0 }) });
  } catch (error) {
    return json(
      {
        error: "Failed to update project",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
};

export const getProjectAnswers = async (request, projectId) => {
  try {
    await ensureAssessmentSchema();
    const auth = await getTenantContextOrResponse(request);
    if (auth.response) {
      return auth.response;
    }

    const { tenantId } = auth.context;
    const sql = getSql();

    const projectRow = await getProjectById(sql, tenantId, projectId);
    if (!projectRow) {
      return json({ error: "Project not found" }, 404);
    }

    const answers = await getAnswersByProjectId(sql, tenantId, projectId);
    const answerMap = Object.fromEntries(answers.map((item) => [item.parameterKey, item.value]));

    return json({ projectId, answers, answerMap, total: answers.length });
  } catch (error) {
    return json(
      {
        error: "Failed to load answers",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
};

export const upsertProjectAnswers = async (request, projectId) => {
  try {
    await ensureAssessmentSchema();
    const auth = await getTenantContextOrResponse(request);
    if (auth.response) {
      return auth.response;
    }

    const { tenantId, role, user } = auth.context;
    if (!canMutateAssessments(role)) {
      return json({ error: "Forbidden by role policy" }, 403);
    }

    const sql = getSql();

    const projectRow = await getProjectById(sql, tenantId, projectId);
    if (!projectRow) {
      return json({ error: "Project not found" }, 404);
    }

    const payload = await parseJsonBody(request);
    const entries = normalizeAnswerEntries(payload.answers);

    if (entries.length === 0) {
      return json({ error: "Request body must include answers" }, 400);
    }

    const parameterRows = await sql`SELECT key FROM parameters`;
    const validParameterKeys = new Set(parameterRows.map((row) => row.key));

    const invalidKeys = entries
      .map((entry) => entry.parameterKey)
      .filter((key) => !validParameterKeys.has(key));

    if (invalidKeys.length > 0) {
      return json(
        {
          error: "Unknown parameter keys",
          invalidKeys,
        },
        400,
      );
    }

    let savedCount = 0;
    let clearedCount = 0;

    for (const entry of entries) {
      if (isMeaningfulValue(entry.value)) {
        await sql`
          INSERT INTO answers (project_id, tenant_id, parameter_key, value, updated_at)
          VALUES (${projectId}, ${tenantId}, ${entry.parameterKey}, ${JSON.stringify(entry.value)}, NOW())
          ON CONFLICT (project_id, parameter_key) DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            value = EXCLUDED.value,
            updated_at = NOW()
        `;
        savedCount += 1;
      } else {
        await sql`
          DELETE FROM answers
          WHERE project_id = ${projectId}
            AND tenant_id = ${tenantId}
            AND parameter_key = ${entry.parameterKey}
        `;
        clearedCount += 1;
      }
    }

    await sql`
      UPDATE projects
      SET updated_at = NOW()
      WHERE id = ${projectId}
        AND tenant_id = ${tenantId}
    `;

    await writeAuditLog(sql, {
      tenantId,
      actorUserId: user.id,
      action: "project.answers.upsert",
      entityType: "project",
      entityId: projectId,
      payload: {
        savedCount,
        clearedCount,
        keys: entries.map((item) => item.parameterKey),
      },
    });

    const answers = await getAnswersByProjectId(sql, tenantId, projectId);

    return json({
      projectId,
      savedCount,
      clearedCount,
      totalAnswers: answers.length,
      answers,
      answerMap: Object.fromEntries(answers.map((item) => [item.parameterKey, item.value])),
    });
  } catch (error) {
    return json(
      {
        error: "Failed to upsert answers",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
};

export const getProjectReport = async (request, projectId) => {
  try {
    await ensureAssessmentSchema();
    const auth = await getTenantContextOrResponse(request);
    if (auth.response) {
      return auth.response;
    }

    const { tenantId } = auth.context;
    const sql = getSql();

    const projectRow = await getProjectById(sql, tenantId, projectId);
    if (!projectRow) {
      return json({ error: "Project not found" }, 404);
    }

    const [parameters, answers] = await Promise.all([
      getParameters(sql),
      getAnswersByProjectId(sql, tenantId, projectId),
    ]);

    const answerMap = Object.fromEntries(answers.map((item) => [item.parameterKey, item.value]));
    const answeredKeys = new Set(
      Object.entries(answerMap)
        .filter(([, value]) => isMeaningfulValue(value))
        .map(([key]) => key),
    );

    const requiredParameters = parameters.filter((parameter) => parameter.required);
    const missingRequired = requiredParameters
      .filter((parameter) => !answeredKeys.has(parameter.key))
      .map((parameter) => ({
        key: parameter.key,
        category: parameter.category,
        label: parameter.label,
        description: parameter.description,
      }));

    const requiredAnswered = requiredParameters.length - missingRequired.length;
    const completenessPercent =
      requiredParameters.length === 0 ? 100 : Math.round((requiredAnswered / requiredParameters.length) * 100);

    const categoryOrder = ["E", "S", "G"];
    const categorySummary = categoryOrder.map((category) => {
      const parametersInCategory = parameters.filter((parameter) => parameter.category === category);
      const requiredInCategory = parametersInCategory.filter((parameter) => parameter.required);
      const answeredInCategory = parametersInCategory.filter((parameter) => answeredKeys.has(parameter.key));
      const requiredAnsweredInCategory = requiredInCategory.filter((parameter) => answeredKeys.has(parameter.key));

      return {
        category,
        total: parametersInCategory.length,
        answered: answeredInCategory.length,
        required: requiredInCategory.length,
        requiredAnswered: requiredAnsweredInCategory.length,
        completenessPercent:
          requiredInCategory.length === 0
            ? 100
            : Math.round((requiredAnsweredInCategory.length / requiredInCategory.length) * 100),
      };
    });

    return json({
      project: normalizeProject({ ...projectRow, answer_count: answers.length }),
      generatedAt: new Date().toISOString(),
      completenessPercent,
      totals: {
        parameters: parameters.length,
        answered: answeredKeys.size,
        required: requiredParameters.length,
        requiredAnswered,
        missingRequired: missingRequired.length,
      },
      missingRequired,
      categorySummary,
      answerMap,
    });
  } catch (error) {
    return json(
      {
        error: "Failed to build report",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
};
