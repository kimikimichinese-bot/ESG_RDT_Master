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

export type HealthState = "ok" | "warn" | "down";

export type RequestStatus = "ok" | "ready" | "degraded";

export interface CheckDetail {
  status: HealthState;
  detail?: string;
}

export interface ApiCheck {
  web?: HealthState;
  db?: HealthState;
  tenantScope?: HealthState;
  eventStore?: HealthState;
  calculationEngine?: HealthState;
}

export interface HealthResponse {
  status: RequestStatus;
  service: string;
  checks: ApiCheck;
  tenantHeader?: string | null;
  ready: boolean;
  workerReady?: boolean;
  timestamp: string;
  version: string;
  requestId?: string;
}

export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
  timestamp: string;
}

export interface ProgressSignal {
  label: string;
  status: string;
  detail: string;
}

export interface ModuleProgress {
  area: string;
  done: number;
}

export interface ReleaseProgressState {
  service: string;
  releaseStatus: string;
  productSignals: ProgressSignal[];
  progress: ModuleProgress[];
  quickActions: string[];
  generatedAt: string;
  version?: string;
  status?: string;
}
