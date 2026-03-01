export const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export const hasHealthContract = (payload) => {
  if (!isPlainObject(payload)) {
    return false;
  }

  const checks = payload.checks;
  const checksOk = isPlainObject(checks);
  return (
    checksOk &&
    typeof payload.status === "string" &&
    typeof payload.requestId === "string" &&
    typeof payload.ready === "boolean" &&
    typeof payload.timestamp === "string" &&
    typeof payload.service === "string" &&
    typeof payload.version === "string"
  );
};

export const hasProgressContract = (payload) => {
  if (!isPlainObject(payload)) {
    return false;
  }

  return (
    typeof payload.service === "string" &&
    typeof payload.releaseStatus === "string" &&
    Array.isArray(payload.productSignals) &&
    Array.isArray(payload.progress)
  );
};

export const isWorkerJob = (job) => {
  if (!isPlainObject(job)) {
    return false;
  }

  if (typeof job.id !== "string" || job.id.trim().length === 0) {
    return false;
  }
  if (typeof job.jobType !== "string" || job.jobType.trim().length === 0) {
    return false;
  }
  if (job.status !== "queued" && job.status !== "running" && job.status !== "succeeded" && job.status !== "failed") {
    return false;
  }
  if (typeof job.requestedAt !== "string") {
    return false;
  }
  if (typeof job.updatedAt !== "string") {
    return false;
  }
  if (typeof job.progress !== "number") {
    return false;
  }
  if (typeof job.tenantId !== "string" && job.tenantId !== null) {
    return false;
  }
  if (typeof job.message !== "string") {
    return false;
  }
  if (typeof job.attempts !== "number") {
    return false;
  }
  if (job.lastError !== null && typeof job.lastError !== "string") {
    return false;
  }
  if (job.result !== null && typeof job.result !== "object") {
    return false;
  }

  return true;
};

export const hasWorkerJobsShape = (payload) => {
  if (!isPlainObject(payload)) {
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
  if (payload.workerState !== null && (!isPlainObject(payload.workerState) || Array.isArray(payload.workerState))) {
    return false;
  }

  if (payload.workerState) {
    if (typeof payload.workerState.workerId !== "string" || payload.workerState.workerId.trim().length === 0) {
      return false;
    }
    if (payload.workerState.status !== "idle" && payload.workerState.status !== "busy") {
      return false;
    }
    if (typeof payload.workerState.lastHeartbeatAt !== "string" || payload.workerState.lastHeartbeatAt.trim().length === 0) {
      return false;
    }
    if (typeof payload.workerState.processedJobs !== "number" || Number.isFinite(payload.workerState.processedJobs) === false) {
      return false;
    }
    if (payload.workerState.activeJobId !== null && typeof payload.workerState.activeJobId !== "string") {
      return false;
    }
    if (typeof payload.workerState.version !== "string" || payload.workerState.version.trim().length === 0) {
      return false;
    }
  }

  if (!Array.isArray(payload.jobs)) {
    return false;
  }

  if (payload.jobs.length === 0) {
    return true;
  }

  return payload.jobs.every((job) => isWorkerJob(job));
};

export const hasJobsContract = (payload) => {
  if (!isPlainObject(payload)) {
    return false;
  }

  if (!Array.isArray(payload.jobs) || typeof payload.workerReady !== "boolean") {
    return false;
  }

  return true;
};

export const parseJsonResponse = async (url, init) => {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null;

  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch (_error) {
      body = {
        parseError: "Invalid JSON payload",
        raw,
      };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body,
  };
};

export const normalizeJobs = (payload) => {
  if (!hasWorkerJobsShape(payload)) {
    return [];
  }

  return payload.jobs.map((job) => ({
    id: typeof job?.id === "string" ? job.id : "unknown",
    status: typeof job?.status === "string" ? job.status : "unknown",
    progress: typeof job?.progress === "number" ? job.progress : 0,
    message: typeof job?.message === "string" ? job.message : "",
    jobType: typeof job?.jobType === "string" ? job.jobType : "unknown",
    updatedAt: typeof job?.updatedAt === "string" ? job.updatedAt : "",
    requestedAt: typeof job?.requestedAt === "string" ? job.requestedAt : "",
  }));
};
