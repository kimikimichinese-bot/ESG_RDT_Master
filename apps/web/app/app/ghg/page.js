"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const currentYear = new Date().getFullYear();
const SCOPE_TABS = [
  { value: "scope1", label: "Scope 1" },
  { value: "scope2", label: "Scope 2" },
  { value: "scope3", label: "Scope 3" },
];

const LIBRARIES = ["IPCC", "DEFRA", "EPA", "CUSTOM"];

const asNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toApiError = (payload, status) => {
  const code = typeof payload?.code === "string" && payload.code.trim() ? payload.code.trim() : `http_${status || 500}`;
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${status || 500}`;
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
  return { code, message, requestId };
};

const describeSupportStatus = (value) => {
  if (value === "supported") {
    return "Supported";
  }
  if (value === "partial") {
    return "Partial";
  }
  if (value === "not_enabled") {
    return "Not enabled";
  }
  return "Not ready";
};

const describeFactorResolution = (value) => {
  if (value === "country_override") {
    return "country override";
  }
  if (value === "tenant_default") {
    return "tenant default";
  }
  if (value === "library_suggestion") {
    return "library suggestion";
  }
  if (value === "missing") {
    return "missing";
  }
  return value || "n/a";
};

const formatFactorValue = (factor) => {
  if (!factor || factor.value == null) {
    return "-";
  }
  return `${factor.value} ${factor.unit || ""}`.trim();
};

const normalizeMetadataValue = (field, rawValue) => {
  if (field.type === "number") {
    return asNumber(rawValue);
  }
  if (field.type === "boolean") {
    return rawValue === "true" || rawValue === true;
  }
  return String(rawValue ?? "").trim();
};

const parseCsvRows = (text) => {
  const normalized = String(text || "").replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], error: "CSV must include header + at least one row" };
  }

  const headers = lines[0].split(",").map((item) => item.trim().toLowerCase());
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  if (!indexByHeader.has("activity_key")) {
    return { rows: [], error: "Missing required CSV column: activity_key" };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",").map((item) => item.trim());
    const read = (header) => cells[indexByHeader.get(header)] || "";

    let metadata = {};
    const metadataRaw = read("metadata_json");
    if (metadataRaw) {
      try {
        const parsed = JSON.parse(metadataRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed;
        }
      } catch (_error) {
        return { rows: [], error: `Invalid metadata_json at row ${i + 1}` };
      }
    }

    rows.push({
      activityKey: read("activity_key"),
      month: read("month"),
      quantity: read("quantity"),
      amount: read("amount"),
      currency: read("currency"),
      directTco2e: read("direct_tco2e"),
      notes: read("notes"),
      metadata,
    });
  }

  return { rows, error: null };
};

const createEmptyDraft = () => ({
  activityDefId: "",
  month: "",
  quantity: "",
  amount: "",
  currency: "EUR",
  directTco2e: "",
  notes: "",
  metadata: {},
  evidenceIds: [],
});

export default function GhgPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [reportingYear, setReportingYear] = useState(currentYear);
  const [library, setLibrary] = useState("IPCC");
  const [selectedScope, setSelectedScope] = useState("scope1");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");

  const [sites, setSites] = useState([]);
  const [evidence, setEvidence] = useState([]);

  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [definitions, setDefinitions] = useState([]);
  const [records, setRecords] = useState([]);
  const [computeResult, setComputeResult] = useState(null);

  const [draft, setDraft] = useState(createEmptyDraft);
  const [queuedRows, setQueuedRows] = useState([]);
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setSelectedCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const filteredSites = useMemo(
    () => sites.filter((site) => !selectedCompanyId || site.companyId === selectedCompanyId),
    [selectedCompanyId, sites],
  );

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }
    if (!filteredSites.some((site) => site.id === selectedSiteId)) {
      setSelectedSiteId("");
    }
  }, [filteredSites, selectedSiteId]);

  const definitionById = useMemo(() => new Map(definitions.map((item) => [item.id, item])), [definitions]);
  const definitionByKey = useMemo(() => new Map(definitions.map((item) => [item.key, item])), [definitions]);

  const activeDefinition = useMemo(() => definitionById.get(draft.activityDefId) || null, [definitionById, draft.activityDefId]);

  const canWrite = tenant.role !== "Auditor";

  const loadScopeData = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    const siteQuery = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : "";
    const [sitesRes, evidenceRes] = await Promise.all([
      fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites${siteQuery}`, { cache: "no-store" }),
      fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence`, { cache: "no-store" }),
    ]);

    const [sitesPayload, evidencePayload] = await Promise.all([
      sitesRes.json().catch(() => ({})),
      evidenceRes.json().catch(() => ({})),
    ]);

    if (!sitesRes.ok || !evidenceRes.ok) {
      throw toApiError(sitesPayload?.ok === false ? sitesPayload : evidencePayload, sitesRes.ok ? evidenceRes.status : sitesRes.status);
    }

    setSites(Array.isArray(sitesPayload?.sites) ? sitesPayload.sites : []);
    setEvidence(Array.isArray(evidencePayload?.evidence) ? evidencePayload.evidence : []);
  }, [selectedCompanyId, tenant.tenantId]);

  const loadInventory = useCallback(async () => {
    if (!tenant.tenantId || !selectedCompanyId || !reportingYear) {
      setDefinitions([]);
      setRecords([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const definitionQuery = new URLSearchParams({ scope: selectedScope });
      definitionQuery.set("companyId", selectedCompanyId);
      const recordQuery = new URLSearchParams({
        companyId: selectedCompanyId,
        year: String(reportingYear),
        scope: selectedScope,
      });
      if (selectedSiteId) {
        recordQuery.set("siteId", selectedSiteId);
      }

      const [definitionsRes, recordsRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ghg/definitions?${definitionQuery.toString()}`, {
          cache: "no-store",
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ghg/records?${recordQuery.toString()}`, {
          cache: "no-store",
        }),
      ]);

      const [definitionsBody, recordsBody] = await Promise.all([
        definitionsRes.json().catch(() => ({})),
        recordsRes.json().catch(() => ({})),
      ]);

      if (!definitionsRes.ok || definitionsBody?.ok === false) {
        throw toApiError(definitionsBody, definitionsRes.status);
      }
      if (!recordsRes.ok || recordsBody?.ok === false) {
        throw toApiError(recordsBody, recordsRes.status);
      }

      const nextDefinitions = Array.isArray(definitionsBody?.definitions) ? definitionsBody.definitions : [];
      const nextRecords = Array.isArray(recordsBody?.records) ? recordsBody.records : [];

      setDefinitions(nextDefinitions);
      setRecords(nextRecords);

      setDraft((current) => {
        if (current.activityDefId && nextDefinitions.some((item) => item.id === current.activityDefId)) {
          return current;
        }
        const fallback = nextDefinitions[0]?.id || "";
        return { ...current, activityDefId: fallback, metadata: {} };
      });
    } catch (loadError) {
      const details =
        loadError && typeof loadError === "object" && "message" in loadError
          ? loadError
          : { code: "ghg_load_failed", message: "Unable to load GHG inventory", requestId: null };
      const requestIdLine = details.requestId ? ` (requestId: ${details.requestId})` : "";
      setError(`${details.message}${requestIdLine}`);
      setDefinitions([]);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [reportingYear, selectedCompanyId, selectedScope, selectedSiteId, tenant.tenantId]);

  const loadCompute = useCallback(async () => {
    if (!tenant.tenantId || !selectedCompanyId || !reportingYear) {
      setComputeResult(null);
      return;
    }

    setComputing(true);
    setError("");

    try {
      const query = new URLSearchParams({
        year: String(reportingYear),
        companyId: selectedCompanyId,
        library,
      });
      if (selectedSiteId) {
        query.set("siteId", selectedSiteId);
      }

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ghg/compute?${query.toString()}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw toApiError(body, response.status);
      }

      setComputeResult(body);
    } catch (loadError) {
      const details =
        loadError && typeof loadError === "object" && "message" in loadError
          ? loadError
          : { code: "ghg_compute_failed", message: "Unable to compute emissions", requestId: null };
      const requestIdLine = details.requestId ? ` (requestId: ${details.requestId})` : "";
      setError(`${details.message}${requestIdLine}`);
      setComputeResult(null);
    } finally {
      setComputing(false);
    }
  }, [library, reportingYear, selectedCompanyId, selectedSiteId, tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadScopeData().catch((scopeError) => {
        const details =
          scopeError && typeof scopeError === "object" && "message" in scopeError
            ? scopeError
            : { message: "Unable to load site/evidence scope", requestId: null };
        const requestIdLine = details.requestId ? ` (requestId: ${details.requestId})` : "";
        setError(`${details.message}${requestIdLine}`);
      });
    }
  }, [tenant.loading, tenant.tenantId, loadScopeData]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && selectedCompanyId && reportingYear) {
      void loadInventory();
      void loadCompute();
    }
  }, [tenant.loading, tenant.tenantId, selectedCompanyId, selectedSiteId, selectedScope, reportingYear, loadInventory, loadCompute]);

  const validateDraft = useCallback(
    (candidate) => {
      const definition = definitionById.get(candidate.activityDefId);
      if (!definition) {
        return "Select a valid activity template.";
      }

      if (definition.method === "activity" && asNumber(candidate.quantity) == null) {
        return "Quantity is required for activity method.";
      }
      if (definition.method === "spend") {
        if (asNumber(candidate.amount) == null) {
          return "Amount is required for spend method.";
        }
        if (!String(candidate.currency || "").trim()) {
          return "Currency is required for spend method.";
        }
      }
      if (definition.method === "direct_tco2e" && asNumber(candidate.directTco2e) == null) {
        return "direct_tco2e is required for direct_tco2e method.";
      }
      if (definition.method === "supplier_specific") {
        const hasDirect = asNumber(candidate.directTco2e) != null;
        const hasQuantity = asNumber(candidate.quantity) != null;
        if (!hasDirect && !hasQuantity) {
          return "supplier_specific requires direct_tco2e or quantity.";
        }
      }

      if (candidate.month !== "") {
        const month = Number.parseInt(String(candidate.month), 10);
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          return "month must be between 1 and 12";
        }
      }

      return "";
    },
    [definitionById],
  );

  const queueCurrentDraft = useCallback(() => {
    if (!selectedCompanyId) {
      setError("Select a company before adding records.");
      return;
    }

    const validationMessage = validateDraft(draft);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    const row = {
      localId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      companyId: selectedCompanyId,
      siteId: selectedSiteId || null,
      reportingYear,
      month: draft.month === "" ? null : Number.parseInt(String(draft.month), 10),
      activityDefId: draft.activityDefId,
      quantity: asNumber(draft.quantity),
      amount: asNumber(draft.amount),
      currency: String(draft.currency || "").trim() || null,
      directTco2e: asNumber(draft.directTco2e),
      metadata: draft.metadata,
      notes: String(draft.notes || "").trim() || null,
      evidenceIds: Array.isArray(draft.evidenceIds) ? draft.evidenceIds : [],
    };

    setQueuedRows((current) => [...current, row]);
    setDraft((current) => ({
      ...createEmptyDraft(),
      activityDefId: current.activityDefId,
      currency: current.currency || "EUR",
    }));
    setMessage("Record queued. Save queued rows to persist.");
    setError("");
  }, [draft, reportingYear, selectedCompanyId, selectedSiteId, validateDraft]);

  const saveQueuedRows = useCallback(async () => {
    if (!tenant.tenantId || queuedRows.length === 0) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        records: queuedRows.map((row) => ({
          companyId: row.companyId,
          siteId: row.siteId,
          reportingYear: row.reportingYear,
          month: row.month,
          activityDefId: row.activityDefId,
          quantity: row.quantity,
          amount: row.amount,
          currency: row.currency,
          directTco2e: row.directTco2e,
          metadata: row.metadata,
          notes: row.notes,
          evidenceIds: row.evidenceIds,
        })),
      };

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ghg/records`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw toApiError(body, response.status);
      }

      setQueuedRows([]);
      setMessage(`Saved ${Array.isArray(body?.records) ? body.records.length : payload.records.length} GHG record(s).`);
      await Promise.all([loadInventory(), loadCompute()]);
    } catch (saveError) {
      const details =
        saveError && typeof saveError === "object" && "message" in saveError
          ? saveError
          : { message: "Unable to save queued records", requestId: null };
      const requestIdLine = details.requestId ? ` (requestId: ${details.requestId})` : "";
      setError(`${details.message}${requestIdLine}`);
    } finally {
      setSaving(false);
    }
  }, [loadCompute, loadInventory, queuedRows, tenant.tenantId]);

  const queueCsvRecords = useCallback(() => {
    if (!selectedCompanyId) {
      setError("Select a company before importing CSV.");
      return;
    }

    setImportingCsv(true);
    setError("");

    try {
      const parsed = parseCsvRows(csvText);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }

      const nextRows = [];
      for (const row of parsed.rows) {
        const definition = definitionByKey.get(String(row.activityKey || "").toLowerCase());
        if (!definition) {
          setError(`Unknown activity_key in CSV: ${row.activityKey}`);
          return;
        }

        nextRows.push({
          localId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          companyId: selectedCompanyId,
          siteId: selectedSiteId || null,
          reportingYear,
          month: row.month ? Number.parseInt(row.month, 10) : null,
          activityDefId: definition.id,
          quantity: asNumber(row.quantity),
          amount: asNumber(row.amount),
          currency: String(row.currency || "").trim() || null,
          directTco2e: asNumber(row.directTco2e),
          metadata: row.metadata || {},
          notes: String(row.notes || "").trim() || null,
          evidenceIds: [],
        });
      }

      setQueuedRows((current) => [...current, ...nextRows]);
      setMessage(`Queued ${nextRows.length} CSV record(s). Save queued rows to persist.`);
    } finally {
      setImportingCsv(false);
    }
  }, [csvText, definitionByKey, reportingYear, selectedCompanyId, selectedSiteId]);

  const onCsvFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    setCsvText(text);
  }, []);

  const scopeRecords = useMemo(() => {
    if (!computeResult?.records || !Array.isArray(computeResult.records)) {
      return [];
    }
    return computeResult.records.filter((item) => item.scope === selectedScope);
  }, [computeResult, selectedScope]);

  const hasScope3Templates = useMemo(
    () => definitions.some((item) => item.scope === "scope3"),
    [definitions],
  );
  const issueSummary = useMemo(
    () => ({
      missingFactorsCount: computeResult?.summary?.missingFactorsCount ?? (computeResult?.missingFactors?.length || 0),
      unsupportedCategoriesCount: computeResult?.summary?.unsupportedCategoriesCount ?? 0,
      missingEvidenceCount: computeResult?.summary?.missingEvidenceCount ?? 0,
      nonComputableRecordCount: computeResult?.summary?.nonComputableRecordCount ?? 0,
    }),
    [computeResult],
  );

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">GHG Inventory</h2>
          <p className="enterprise-muted">Data-driven Scope 1/2/3 activity records with dynamic templates and evidence linkage.</p>
        </div>
        <div className="enterprise-inline-actions">
          <Link className="enterprise-button-secondary" href="/app/definitions?type=ghg">
            Manage fields
          </Link>
          <button className="enterprise-button-secondary" type="button" onClick={() => void Promise.all([loadInventory(), loadCompute()])}>
            Refresh
          </button>
          <button className="enterprise-button-primary" type="button" onClick={() => void saveQueuedRows()} disabled={!canWrite || saving || queuedRows.length === 0}>
            {saving ? "Saving..." : `Save queued (${queuedRows.length})`}
          </button>
        </div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <label className="enterprise-label" htmlFor="ghg-year">Reporting year</label>
          <input
            id="ghg-year"
            className="enterprise-input"
            type="number"
            min="1900"
            max="2200"
            value={reportingYear}
            onChange={(event) => setReportingYear(Number(event.target.value) || currentYear)}
          />

          <label className="enterprise-label" htmlFor="ghg-company">Company</label>
          <select
            id="ghg-company"
            className="enterprise-input"
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              companyScope.setActiveCompanyId(event.target.value);
            }}
          >
            <option value="">Select company</option>
            {companyScope.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
                {company.isHolding ? " (Holding)" : ""}
              </option>
            ))}
          </select>

          <label className="enterprise-label" htmlFor="ghg-site">Site (optional)</label>
          <select
            id="ghg-site"
            className="enterprise-input"
            value={selectedSiteId}
            onChange={(event) => setSelectedSiteId(event.target.value)}
          >
            <option value="">Company-level only</option>
            {filteredSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
                {site.country ? ` (${site.country})` : ""}
              </option>
            ))}
          </select>

          <label className="enterprise-label" htmlFor="ghg-library">Fallback library</label>
          <select
            id="ghg-library"
            className="enterprise-input"
            value={library}
            onChange={(event) => setLibrary(event.target.value)}
          >
            {LIBRARIES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="enterprise-inline-actions">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={selectedScope === tab.value ? "enterprise-button-primary" : "enterprise-button-secondary"}
            onClick={() => setSelectedScope(tab.value)}
          >
            <TooltipText
              text={
                tab.value === "scope1"
                  ? "Emissioni dirette"
                  : tab.value === "scope2"
                    ? "Energia acquistata"
                    : "Emissioni indirette"
              }
            >
              {tab.label}
            </TooltipText>
          </button>
        ))}
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status">{message}</p> : null}
      {loading ? <p className="enterprise-status">Loading GHG templates and records...</p> : null}

      <div className="enterprise-kpi-grid" style={{ position: "sticky", top: 12, zIndex: 2 }}>
        <article className="enterprise-kpi-card">
          <strong>
            <TooltipText text="Fattori mancanti">Missing factors</TooltipText>
          </strong>
          <p>{issueSummary.missingFactorsCount}</p>
        </article>
        <article className="enterprise-kpi-card">
          <strong>Unsupported categories</strong>
          <p>{issueSummary.unsupportedCategoriesCount}</p>
        </article>
        <article className="enterprise-kpi-card">
          <strong>Missing evidence</strong>
          <p>{issueSummary.missingEvidenceCount}</p>
        </article>
      </div>

      {selectedScope === "scope3" && !hasScope3Templates ? (
        <div className="enterprise-warning">No Scope 3 templates are active. Enable Scope 3 templates in the GHG catalog.</div>
      ) : null}

      {issueSummary.nonComputableRecordCount > 0 ? (
        <div className="enterprise-warning">
          Record present but not computable: {issueSummary.nonComputableRecordCount} record(s) still need a supported category, a usable factor, or a direct method before totals should be shared.
        </div>
      ) : null}

      {selectedScope === "scope3" && issueSummary.unsupportedCategoriesCount > 0 ? (
        <div className="enterprise-warning">
          Category not enabled: some Scope 3 categories remain outside the pilot perimeter. Keep them out of committed totals and verify the support matrix below.
        </div>
      ) : null}

      {issueSummary.missingEvidenceCount > 0 ? (
        <div className="enterprise-warning">
          Evidence missing: {issueSummary.missingEvidenceCount} record(s) still require evidence. <Link href="/app/evidence">Aggiungi evidenza</Link>
        </div>
      ) : null}

      <div className="enterprise-card">
        <h3 className="enterprise-section-title">
          <TooltipText text="Aggiungi un record">Quick add activity record</TooltipText>
        </h3>
        <div className="enterprise-filter-grid">
          <label className="enterprise-label" htmlFor="ghg-activity">Activity template</label>
          <select
            id="ghg-activity"
            className="enterprise-input"
            value={draft.activityDefId}
            onChange={(event) => setDraft((current) => ({ ...current, activityDefId: event.target.value, metadata: {} }))}
            disabled={definitions.length === 0}
          >
            {definitions.length === 0 ? <option value="">No templates in this scope</option> : null}
            {definitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name} [{definition.method} · {definition.unit}]
              </option>
            ))}
          </select>

          <label className="enterprise-label" htmlFor="ghg-month">Month (optional)</label>
          <input
            id="ghg-month"
            className="enterprise-input"
            type="number"
            min="1"
            max="12"
            value={draft.month}
            onChange={(event) => setDraft((current) => ({ ...current, month: event.target.value }))}
          />

          {activeDefinition?.method === "activity" || activeDefinition?.method === "supplier_specific" ? (
            <>
              <label className="enterprise-label" htmlFor="ghg-quantity">Quantity ({activeDefinition?.unit || "unit"})</label>
              <input
                id="ghg-quantity"
                className="enterprise-input"
                type="number"
                step="any"
                value={draft.quantity}
                onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}
              />
            </>
          ) : null}

          {activeDefinition?.method === "spend" ? (
            <>
              <label className="enterprise-label" htmlFor="ghg-amount">Amount</label>
              <input
                id="ghg-amount"
                className="enterprise-input"
                type="number"
                step="any"
                value={draft.amount}
                onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
              />

              <label className="enterprise-label" htmlFor="ghg-currency">Currency</label>
              <input
                id="ghg-currency"
                className="enterprise-input"
                type="text"
                value={draft.currency}
                onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
              />
            </>
          ) : null}

          {activeDefinition?.method === "direct_tco2e" || activeDefinition?.method === "supplier_specific" ? (
            <>
              <label className="enterprise-label" htmlFor="ghg-direct">Direct tCO2e</label>
              <input
                id="ghg-direct"
                className="enterprise-input"
                type="number"
                step="any"
                value={draft.directTco2e}
                onChange={(event) => setDraft((current) => ({ ...current, directTco2e: event.target.value }))}
              />
            </>
          ) : null}

          {(activeDefinition?.inputSchema?.fields || []).map((field) => {
            const fieldKey = String(field.key || "").trim();
            if (!fieldKey) {
              return null;
            }

            const fieldId = `ghg-meta-${fieldKey}`;
            const value = draft.metadata[fieldKey];

            if (field.type === "select" && Array.isArray(field.options)) {
              return (
                <Fragment key={fieldId}>
                  <label className="enterprise-label" htmlFor={fieldId}>
                    {field.label || fieldKey}
                  </label>
                  <select
                    id={fieldId}
                    className="enterprise-input"
                    value={String(value ?? "")}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        metadata: {
                          ...current.metadata,
                          [fieldKey]: normalizeMetadataValue(field, event.target.value),
                        },
                      }))
                    }
                  >
                    <option value="">Select</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Fragment>
              );
            }

            if (field.type === "boolean") {
              return (
                <Fragment key={fieldId}>
                  <label className="enterprise-label" htmlFor={fieldId}>
                    {field.label || fieldKey}
                  </label>
                  <select
                    id={fieldId}
                    className="enterprise-input"
                    value={value == null ? "" : String(Boolean(value))}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        metadata: {
                          ...current.metadata,
                          [fieldKey]: normalizeMetadataValue(field, event.target.value),
                        },
                      }))
                    }
                  >
                    <option value="">Unknown</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </Fragment>
              );
            }

            return (
              <Fragment key={fieldId}>
                <label className="enterprise-label" htmlFor={fieldId}>
                  {field.label || fieldKey}
                </label>
                <input
                  id={fieldId}
                  className="enterprise-input"
                  type={field.type === "number" ? "number" : "text"}
                  value={value == null ? "" : String(value)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      metadata: {
                        ...current.metadata,
                        [fieldKey]: normalizeMetadataValue(field, event.target.value),
                      },
                    }))
                  }
                />
              </Fragment>
            );
          })}

          <label className="enterprise-label" htmlFor="ghg-notes">Notes</label>
          <input
            id="ghg-notes"
            className="enterprise-input"
            type="text"
            value={draft.notes}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          />

          <label className="enterprise-label" htmlFor="ghg-evidence">Evidence</label>
          <select
            id="ghg-evidence"
            className="enterprise-input"
            multiple
            value={draft.evidenceIds}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                evidenceIds: [...event.target.selectedOptions].map((option) => option.value),
              }))
            }
          >
            {evidence.map((item) => (
              <option key={item.id} value={item.id}>{item.filename}</option>
            ))}
          </select>
        </div>

        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => setDraft(createEmptyDraft())}>
            Reset form
          </button>
          <button
            className="enterprise-button-primary"
            type="button"
            onClick={queueCurrentDraft}
            disabled={!canWrite || !selectedCompanyId || !draft.activityDefId}
          >
            Queue row
          </button>
        </div>
      </div>

      <div className="enterprise-card">
        <h3 className="enterprise-section-title">Import activity CSV</h3>
        <p className="enterprise-muted">Expected headers: activity_key,month,quantity,amount,currency,direct_tco2e,notes,metadata_json</p>
        <input className="enterprise-input" type="file" accept=".csv,text/csv" onChange={onCsvFileChange} />
        <textarea
          className="enterprise-input"
          rows={6}
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="activity_key,month,quantity,amount,currency,direct_tco2e,notes,metadata_json"
        />
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={queueCsvRecords} disabled={!canWrite || importingCsv}>
            {importingCsv ? "Parsing..." : "Queue CSV rows"}
          </button>
        </div>
      </div>

      {queuedRows.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Month</th>
                <th>Quantity</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Direct tCO2e</th>
                <th>Evidence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {queuedRows.map((row) => {
                const def = definitionById.get(row.activityDefId);
                return (
                  <tr key={row.localId}>
                    <td>{def?.name || row.activityDefId}</td>
                    <td>{row.month ?? "-"}</td>
                    <td>{row.quantity ?? "-"}</td>
                    <td>{row.amount ?? "-"}</td>
                    <td>{row.currency || "-"}</td>
                    <td>{row.directTco2e ?? "-"}</td>
                    <td>{Array.isArray(row.evidenceIds) ? row.evidenceIds.length : 0}</td>
                    <td>
                      <button
                        className="enterprise-button-secondary"
                        type="button"
                        onClick={() => setQueuedRows((current) => current.filter((item) => item.localId !== row.localId))}
                        disabled={!canWrite}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {records.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Month</th>
                <th>Quantity</th>
                <th>Amount</th>
                <th>Direct tCO2e</th>
                <th>Metadata</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.id}>
                  <td>{row.definition?.name || row.activityKey || row.activityDefId}</td>
                  <td>{row.month ?? "-"}</td>
                  <td>{row.quantity ?? "-"}</td>
                  <td>{row.amount != null ? `${row.amount} ${row.currency || ""}` : "-"}</td>
                  <td>{row.directTco2e ?? "-"}</td>
                  <td>
                    {row.metadata && Object.keys(row.metadata).length > 0 ? (
                      <code>{JSON.stringify(row.metadata)}</code>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{Array.isArray(row.evidenceIds) ? row.evidenceIds.length : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !loading && selectedCompanyId ? (
        <div className="enterprise-empty">No records yet for this scope/year.</div>
      ) : null}

      <div className="enterprise-card">
        <div className="enterprise-toolbar">
          <h3 className="enterprise-section-title">Computed emissions</h3>
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadCompute()}>
            {computing ? "Computing..." : "Recompute"}
          </button>
        </div>

        {computeResult?.scopeTotals ? (
          <div className="enterprise-kpi-grid">
            <article className="enterprise-kpi-card">
              <strong>Scope 1 tCO2e</strong>
              <p>{computeResult.scopeTotals.scope1Tco2e}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Scope 2 tCO2e</strong>
              <p>{computeResult.scopeTotals.scope2Tco2e}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Scope 3 tCO2e</strong>
              <p>{computeResult.scopeTotals.scope3Tco2e}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Total tCO2e</strong>
              <p>{computeResult.scopeTotals.totalTco2e}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Factor coverage %</strong>
              <p>{computeResult.coverage}</p>
            </article>
          </div>
        ) : (
          <div className="enterprise-empty">No compute output yet.</div>
        )}

        {Array.isArray(computeResult?.missingFactors) && computeResult.missingFactors.length > 0 ? (
          <div className="enterprise-warning">
            Missing factors: {computeResult.missingFactors.join(", ")}. Add a country override or tenant default in <Link href="/app/factors">Factors</Link>.
          </div>
        ) : null}

        {Array.isArray(computeResult?.warnings) && computeResult.warnings.length > 0 ? (
          <div className="enterprise-warning">
            {computeResult.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}

        {selectedScope === "scope3" && Array.isArray(computeResult?.scope3Breakdown) && computeResult.scope3Breakdown.length > 0 ? (
          <div className="enterprise-table-wrap">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Scope 3 category</th>
                  <th>Total tCO2e</th>
                </tr>
              </thead>
              <tbody>
                {computeResult.scope3Breakdown.map((item) => (
                  <tr key={`cat-${item.category}`}>
                    <td>Category {item.category}</td>
                    <td>{item.totalTco2e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {selectedScope === "scope3" && Array.isArray(computeResult?.scope3Support) && computeResult.scope3Support.length > 0 ? (
          <div className="enterprise-table-wrap">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Methods</th>
                  <th>Readiness note</th>
                </tr>
              </thead>
              <tbody>
                {computeResult.scope3Support.map((item) => (
                  <tr key={`scope3-support-${item.category}`}>
                    <td>Category {item.category} · {item.label}</td>
                    <td>{describeSupportStatus(item.status)}</td>
                    <td>{Array.isArray(item.methodSupport) ? item.methodSupport.join(", ") : "-"}</td>
                    <td>{item.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {scopeRecords.length > 0 ? (
          <div className="enterprise-table-wrap">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>tCO2e</th>
                  <th>Resolved factor</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {scopeRecords.map((item) => (
                  <tr key={item.recordId}>
                    <td>{item.activityName}</td>
                    <td>{item.tco2e ?? "-"}</td>
                    <td>
                      <div><strong>{item.factorUsed?.key || "-"}</strong></div>
                      <div>{describeFactorResolution(item.factorUsed?.resolution || "missing")}</div>
                      <div>{formatFactorValue(item.factorUsed)}</div>
                    </td>
                    <td>
                      {item.factorUsed?.sourceUrl ? (
                        <a href={item.factorUsed.sourceUrl} target="_blank" rel="noreferrer">
                          {item.factorUsed?.sourceLabel || "source"}
                        </a>
                      ) : (
                        item.factorUsed?.sourceLabel || "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
