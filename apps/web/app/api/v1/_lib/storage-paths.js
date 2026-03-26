const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeSegment = (value, fallback = "") => {
  const normalized = toCleanString(value)
    .replace(/[_-]+/g, " ")
    .replace(/[\\/:*?"<>|#%]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();
  return normalized || fallback;
};

const dedupeSegments = (segments) => {
  const next = [];
  for (const segment of segments) {
    const normalized = normalizeSegment(segment);
    if (!normalized) {
      continue;
    }
    const previous = next[next.length - 1];
    if (previous && previous.toLowerCase() === normalized.toLowerCase()) {
      continue;
    }
    next.push(normalized);
  }
  return next;
};

const stripRootFolderDuplication = (segments, config = {}) => {
  const rootLeaf = normalizeSegment(String(config.rootFolderPath || "").split("/").filter(Boolean).pop());
  if (!rootLeaf) {
    return segments;
  }
  return segments.filter((segment) => segment.toLowerCase() !== rootLeaf.toLowerCase());
};

const toYearLabel = (metadata = {}) => {
  const explicit = Number.parseInt(String(metadata.reportingYear || "").trim(), 10);
  if (Number.isFinite(explicit) && explicit >= 2000 && explicit <= 3000) {
    return String(explicit);
  }
  const issueYear = toCleanString(metadata.issueDate).slice(0, 4);
  if (/^\d{4}$/.test(issueYear)) {
    return issueYear;
  }
  return String(new Date().getUTCFullYear());
};

const inferModuleLabel = (metadata = {}) => {
  const explicit = normalizeSegment(metadata.moduleName || metadata.module || metadata.sourceModule);
  if (explicit) {
    return explicit;
  }

  const entityType = toCleanString(metadata.entityType).toLowerCase();
  if (entityType === "materiality_set" || entityType === "materiality") {
    return "Materiality";
  }
  if (entityType === "ghg_activity" || entityType === "ghg") {
    return "GHG";
  }
  if (entityType === "governance_field" || entityType === "governance") {
    return "Governance";
  }
  if (entityType === "social_metric" || entityType === "social") {
    return "Social";
  }
  if (entityType === "environment_metric" || entityType === "environment") {
    return "Environment";
  }

  const docType = toCleanString(metadata.docType).toLowerCase();
  if (docType === "policy") {
    return "Governance";
  }
  if (docType === "action") {
    return "Activities";
  }
  if (docType === "reporting") {
    return "ESG Reporting";
  }
  if (docType === "audit") {
    return "Audit";
  }
  if (docType === "certification") {
    return "Certifications";
  }

  return "General Evidence";
};

const inferCategoryLabel = (metadata = {}) => {
  const explicit = normalizeSegment(metadata.categoryName || metadata.activityName || metadata.activityLabel || metadata.subcategoryName);
  if (explicit) {
    return explicit;
  }

  const docType = toCleanString(metadata.docType).toLowerCase();
  if (docType === "policy") {
    return "Policies";
  }
  if (docType === "action") {
    return "Actions";
  }
  if (docType === "reporting") {
    return "Reporting Pack";
  }
  if (docType === "audit") {
    return "Audit Evidence";
  }
  if (docType === "certification") {
    return "Certifications";
  }

  return "General Evidence";
};

const inferEntityLabel = (metadata = {}) =>
  normalizeSegment(metadata.entityLabel || metadata.entityType, "Evidence");

const interpolatePattern = (pattern, tokens) =>
  String(pattern || "").replace(/\{([a-z_]+)\}/gi, (_match, rawKey) => {
    const key = String(rawKey || "").toLowerCase();
    return tokens[key] || "";
  });

export const buildReadableStorageTokens = ({ tenantId, metadata = {} }) => {
  const tenant = normalizeSegment(metadata.tenantName, normalizeSegment(metadata.tenantLabel, "Unknown Tenant"));
  const company = normalizeSegment(metadata.companyName, "Unknown Company");
  const site = normalizeSegment(metadata.siteName, "Unlinked");
  const year = toYearLabel(metadata);
  const moduleLabel = inferModuleLabel(metadata);
  const category = inferCategoryLabel(metadata);
  const docType = normalizeSegment(metadata.docType, "General Evidence");
  const entityType = inferEntityLabel(metadata);
  const scope = normalizeSegment(metadata.scopeCoverage, "General");
  const filenameBase = normalizeSegment(String(metadata.filenameBase || metadata.filename || "").replace(/\.[^.]+$/u, ""), "evidence");

  return {
    tenant,
    company,
    site,
    year,
    module: moduleLabel,
    category,
    doc_type: docType,
    entity_type: entityType,
    scope,
    activity: category,
    filename_base: filenameBase,
    tenant_id: normalizeSegment(tenantId),
  };
};

export const buildReadableStorageFolderSegments = ({ config = {}, tenantId, metadata = {} }) => {
  const tokens = buildReadableStorageTokens({ tenantId, metadata });

  const finalizeSegments = (segments) => stripRootFolderDuplication(dedupeSegments(segments), config);

  if (config.folderStrategy === "custom") {
    const customPattern = toCleanString(config.customFolderPattern);
    if (!customPattern) {
      return [];
    }
    return finalizeSegments(interpolatePattern(customPattern, tokens).split("/"));
  }

  if (config.folderStrategy === "company_site_year") {
    return finalizeSegments([tokens.company, tokens.site, tokens.year, tokens.module, tokens.category]);
  }
  if (config.folderStrategy === "year_doc_type") {
    return finalizeSegments([tokens.year, tokens.module, tokens.category]);
  }
  if (config.folderStrategy === "company_year_entity_type") {
    return finalizeSegments([tokens.company, tokens.year, tokens.entity_type, tokens.category]);
  }

  return finalizeSegments([tokens.tenant, tokens.company, tokens.year, tokens.module, tokens.category]);
};

export { normalizeSegment as normalizeReadableStorageSegment };
