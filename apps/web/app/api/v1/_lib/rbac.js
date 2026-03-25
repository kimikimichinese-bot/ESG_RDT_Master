import { isReadMethod } from "./http.js";

export const ROLES = {
  TENANT_ADMIN: "TenantAdmin",
  MANAGER: "Manager",
  PERSONNEL: "Personnel",
  AUDITOR: "Auditor",
};

const ROLE_SET = new Set(Object.values(ROLES));

export const isValidRole = (role) => ROLE_SET.has(role);

export const canAccessResource = (role, resource, method) => {
  if (!isValidRole(role)) {
    return false;
  }

  if (resource === "storage") {
    if (isReadMethod(method)) {
      return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER || role === ROLES.AUDITOR;
    }
    return role === ROLES.TENANT_ADMIN;
  }

  if (isReadMethod(method)) {
    return true;
  }

  if (role === ROLES.AUDITOR) {
    return false;
  }

  if (resource === "tenant" || resource === "members") {
    return role === ROLES.TENANT_ADMIN;
  }

  if (resource === "activities") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER || role === ROLES.PERSONNEL;
  }

  if (resource === "metrics") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER;
  }

  if (resource === "governance") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER;
  }

  if (resource === "social" || resource === "factors") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER;
  }

  if (resource === "people") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER || role === ROLES.PERSONNEL;
  }

  if (resource === "sites" || resource === "companies" || resource === "evidence") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER;
  }

  if (resource === "audit") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER;
  }

  if (resource === "assessments" || resource === "ecovadis" || resource === "materiality") {
    return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER;
  }

  return role === ROLES.TENANT_ADMIN || role === ROLES.MANAGER;
};
