import { randomUUID } from "node:crypto";

export const writeAuditLog = async (
  sql,
  { tenantId, actorUserId = null, action, entityType, entityId, payload = {} },
) => {
  await sql`
    INSERT INTO audit_log (id, tenant_id, actor_user_id, action, entity_type, entity_id, payload)
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${actorUserId},
      ${action},
      ${entityType},
      ${String(entityId || "")},
      ${JSON.stringify(payload)}
    )
  `;
};
