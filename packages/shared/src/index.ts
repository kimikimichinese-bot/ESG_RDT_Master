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

export interface HealthResponseContract extends HealthResponse {
  status: RequestStatus;
  service: string;
  checks: ApiCheck;
  ready: boolean;
  timestamp: string;
  version: string;
  requestId: string;
}

export interface ProgressSignalContract {
  label: string;
  status: string;
  detail: string;
  addedAt?: string | null;
  updatedAt?: string | null;
}

export interface ProgressModuleContract {
  area: string;
  done: number;
  buildPriority?: number | null;
  buildLabel?: string | null;
  addedAt?: string | null;
  updatedAt?: string | null;
}

export interface ProgressEndpointContract {
  service: string;
  releaseStatus: string;
  productSignals: ProgressSignalContract[];
  progress: ProgressModuleContract[];
  quickActions: Array<{ text: string; addedAt?: string | null; updatedAt?: string | null }>;
  version?: string;
  status?: string;
  source?: string;
  generatedAt?: string;
}

export interface WorkerJobContract {
  id: string;
  jobType: string;
  tenantId: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  progress: number;
  message: string;
  attempts: number;
  lastError: string | null;
  result: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface WorkerJobsResponseContract {
  service: string;
  requestId: string;
  timestamp: string;
  status?: "ok" | "warn" | "degraded" | "error";
  workerReady: boolean;
  jobs: WorkerJobContract[];
  workerState: {
    workerId: string;
    status: "idle" | "busy";
    lastHeartbeatAt: string;
    processedJobs: number;
    activeJobId: string | null;
    version: string;
  } | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isHealthState = (value: unknown): value is HealthState =>
  value === "ok" || value === "warn" || value === "down";

const isRequestStatus = (value: unknown): value is RequestStatus =>
  value === "ok" || value === "ready" || value === "degraded";

export const isHealthResponse = (payload: unknown): payload is HealthResponseContract => {
  if (!isObject(payload)) {
    return false;
  }

  const checks = payload.checks;
  if (!isObject(checks)) {
    return false;
  }

  const checkValues = Object.values(checks);
  if (!checkValues.every((value) => value === undefined || isHealthState(value))) {
    return false;
  }

  if (typeof payload.service !== "string" || payload.service.trim().length === 0) {
    return false;
  }
  if (!isRequestStatus(payload.status)) {
    return false;
  }
  if (typeof payload.ready !== "boolean") {
    return false;
  }
  if (typeof payload.timestamp !== "string" || payload.timestamp.trim().length === 0) {
    return false;
  }
  if (payload.requestId !== undefined && typeof payload.requestId !== "string") {
    return false;
  }
  if (typeof payload.version !== "string" || payload.version.trim().length === 0) {
    return false;
  }
  return true;
};

export const isProgressEndpointResponse = (payload: unknown): payload is ProgressEndpointContract => {
  if (!isObject(payload)) {
    return false;
  }
  if (typeof payload.service !== "string" || payload.service.trim().length === 0) {
    return false;
  }
  if (typeof payload.releaseStatus !== "string" || payload.releaseStatus.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(payload.productSignals) || !Array.isArray(payload.progress)) {
    return false;
  }
  if (typeof payload.version !== "undefined" && typeof payload.version !== "string") {
    return false;
  }
  return true;
};

export const isWorkerJobsResponse = (payload: unknown): payload is WorkerJobsResponseContract => {
  if (!isObject(payload)) {
    return false;
  }
  if (typeof payload.service !== "string" || payload.service.trim().length === 0) {
    return false;
  }
  if (typeof payload.requestId !== "string" || payload.requestId.trim().length === 0) {
    return false;
  }
  if (typeof payload.timestamp !== "string" || payload.timestamp.trim().length === 0) {
    return false;
  }
  if (typeof payload.workerReady !== "boolean") {
    return false;
  }
  if (!Array.isArray(payload.jobs)) {
    return false;
  }
  return true;
};

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
