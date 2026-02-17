export type TenantId = string;

export type UserRole = "SuperAdmin" | "TenantAdmin" | "Manager" | "Personnel" | "Auditor";

export type EvidenceState = "Draft" | "Submitted" | "Approved" | "Locked";

export type ScopeType = "Scope1" | "Scope2" | "Scope3";

export interface TenantScope {
  tenantId: TenantId;
}

export interface Tenant {
  id: TenantId;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  tenantId: TenantId;
  email: string;
  role: UserRole;
}

export interface Membership {
  id: string;
  tenantId: TenantId;
  userId: string;
  role: UserRole;
}

export interface Site {
  id: string;
  tenantId: TenantId;
  name: string;
  location: string | null;
}

export interface MetricDefinition {
  id: string;
  tenantId: TenantId;
  code: string;
  unit: string;
  description?: string | null;
}

export interface ActivityData {
  id: string;
  tenantId: TenantId;
  metricDefinitionId: string;
  siteId: string;
  amount: number;
  unit: string;
  occurredAt: string;
}

export interface Evidence {
  id: string;
  tenantId: TenantId;
  state: EvidenceState;
}

export interface EmissionResult {
  id: string;
  tenantId: TenantId;
  metricDefinitionId: string;
  value: number;
  unit: string;
  factorSetVersion: string;
}
