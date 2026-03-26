"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
const CONTRACT_TYPES = ["total", "permanent", "temporary"];
const GENDERS = ["M", "F", "D"];
const MONTHS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

const workforceKey = (contractType, month, gender) => `${contractType}:${month}:${gender}`;
const leaverKey = (month, gender) => `${month}:${gender}`;

const createInitialWorkforce = () => {
  const out = {};
  for (const contractType of CONTRACT_TYPES) {
    for (const month of MONTHS) {
      for (const gender of GENDERS) {
        out[workforceKey(contractType, month.value, gender)] = {
          headcount: "0",
          hoursWorked: "0",
        };
      }
    }
  }
  return out;
};

const createInitialLeavers = () => {
  const out = {};
  for (const month of MONTHS) {
    for (const gender of GENDERS) {
      out[leaverKey(month.value, gender)] = "0";
    }
  }
  return out;
};

const createInitialManagement = () => ({ M: "0", F: "0", D: "0" });

const toInt = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const toNumber = (value) => {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export default function SocialPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [reportingYear, setReportingYear] = useState(currentYear);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [sites, setSites] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [workforce, setWorkforce] = useState(createInitialWorkforce);
  const [leavers, setLeavers] = useState(createInitialLeavers);
  const [management, setManagement] = useState(createInitialManagement);
  const [sectionEvidence, setSectionEvidence] = useState({
    workforce: [],
    leavers: [],
    management: [],
  });
  const [companyFlags, setCompanyFlags] = useState({
    genderPayGapReported: false,
    scope3ScreeningPerformed: false,
  });
  const [summary, setSummary] = useState(null);
  const [socialCatalog, setSocialCatalog] = useState([]);
  const [socialRecordsByKey, setSocialRecordsByKey] = useState({});
  const [socialEvidenceByKey, setSocialEvidenceByKey] = useState({});
  const [socialComputed, setSocialComputed] = useState(null);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [customTopic, setCustomTopic] = useState({
    key: "",
    name: "",
    unit: "count",
    sdgs: "",
    evidenceRequired: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setSelectedCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(
    () =>
      !tenant.impersonationReadOnly &&
      (tenant.platformRole === "superadmin" || tenant.role === "TenantAdmin" || tenant.role === "Manager"),
    [tenant.impersonationReadOnly, tenant.platformRole, tenant.role],
  );

  const siteSummary = useMemo(() => {
    if (!summary || !selectedSiteId) {
      return null;
    }
    return (summary.sites || []).find((item) => item.siteId === selectedSiteId) || null;
  }, [selectedSiteId, summary]);

  const companySummary = useMemo(() => {
    if (!summary || !selectedCompanyId) {
      return null;
    }
    return (summary.companies || []).find((item) => item.companyId === selectedCompanyId) || null;
  }, [selectedCompanyId, summary]);

  const loadScopeData = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setError("");
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
      throw new Error("Failed to load sites/evidence scope");
    }

    const nextSites = Array.isArray(sitesPayload.sites) ? sitesPayload.sites : [];
    setSites(nextSites);
    setEvidence(Array.isArray(evidencePayload.evidence) ? evidencePayload.evidence : []);

    if (nextSites.length > 0) {
      if (selectedSiteId && nextSites.some((site) => site.id === selectedSiteId)) {
        return;
      }
      setSelectedSiteId(nextSites[0].id);
      return;
    }
    setSelectedSiteId("");
  }, [selectedCompanyId, selectedSiteId, tenant.tenantId]);

  const loadSummary = useCallback(async () => {
    if (!tenant.tenantId || !reportingYear) {
      return;
    }

    const response = await fetch(
      `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/summary/social?year=${encodeURIComponent(reportingYear)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    setSummary(payload);
  }, [reportingYear, tenant.tenantId]);

  const loadSocialCatalogData = useCallback(async () => {
    if (!tenant.tenantId || !selectedCompanyId || !reportingYear) {
      setSocialCatalog([]);
      setSocialRecordsByKey({});
      setSocialEvidenceByKey({});
      setSocialComputed(null);
      return;
    }

    const query = new URLSearchParams({
      companyId: selectedCompanyId,
      year: String(reportingYear),
    });
    if (selectedSiteId) {
      query.set("siteId", selectedSiteId);
    }

    const [catalogRes, recordsRes] = await Promise.all([
      fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/catalog?companyId=${encodeURIComponent(selectedCompanyId)}`,
        { cache: "no-store" },
      ),
      fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/records?${query.toString()}`, {
        cache: "no-store",
      }),
    ]);

    const [catalogPayload, recordsPayload] = await Promise.all([
      catalogRes.json().catch(() => ({})),
      recordsRes.json().catch(() => ({})),
    ]);

    if (!catalogRes.ok || !recordsRes.ok) {
      throw new Error(
        catalogPayload?.error || recordsPayload?.error || `HTTP ${catalogRes.ok ? recordsRes.status : catalogRes.status}`,
      );
    }

    const metrics = Array.isArray(catalogPayload.metrics) ? catalogPayload.metrics : [];
    const records = Array.isArray(recordsPayload.records) ? recordsPayload.records : [];
    const nextValues = {};
    const nextEvidenceByKey = {};

    for (const metric of metrics) {
      if (metric.method === "manual") {
        nextValues[metric.key] = "0";
        nextEvidenceByKey[metric.key] = [];
      }
    }

    for (const row of records) {
      if (!row.metricKey) {
        continue;
      }
      nextValues[row.metricKey] = row.value == null ? "0" : String(row.value);
      nextEvidenceByKey[row.metricKey] = Array.isArray(row.evidenceIds) ? row.evidenceIds : [];
    }

    setSocialCatalog(metrics);
    setSocialRecordsByKey(nextValues);
    setSocialEvidenceByKey(nextEvidenceByKey);
    setSocialComputed(recordsPayload.computed || null);
  }, [reportingYear, selectedCompanyId, selectedSiteId, tenant.tenantId]);

  const loadSiteYearData = useCallback(async () => {
    if (!tenant.tenantId || !selectedSiteId || !reportingYear) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const query = new URLSearchParams({
        siteId: selectedSiteId,
        year: String(reportingYear),
      }).toString();

      const [workforceRes, leaversRes, managementRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/workforce?${query}`, {
          cache: "no-store",
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/leavers?${query}`, {
          cache: "no-store",
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/management?${query}`, {
          cache: "no-store",
        }),
      ]);

      const [workforcePayload, leaversPayload, managementPayload] = await Promise.all([
        workforceRes.json().catch(() => ({})),
        leaversRes.json().catch(() => ({})),
        managementRes.json().catch(() => ({})),
      ]);

      if (!workforceRes.ok || !leaversRes.ok || !managementRes.ok) {
        throw new Error("Failed to load social blocks");
      }

      const nextWorkforce = createInitialWorkforce();
      for (const row of workforcePayload.rows || []) {
        nextWorkforce[workforceKey(row.contractType, row.month, row.gender)] = {
          headcount: String(row.headcount),
          hoursWorked: String(row.hoursWorked),
        };
      }
      setWorkforce(nextWorkforce);

      const nextLeavers = createInitialLeavers();
      for (const row of leaversPayload.rows || []) {
        nextLeavers[leaverKey(row.month, row.gender)] = String(row.leavers);
      }
      setLeavers(nextLeavers);

      const nextManagement = createInitialManagement();
      for (const row of managementPayload.rows || []) {
        nextManagement[row.gender] = String(row.headcount);
      }
      setManagement(nextManagement);

      setSectionEvidence({
        workforce: Array.isArray(workforcePayload.sectionEvidenceIds) ? workforcePayload.sectionEvidenceIds : [],
        leavers: Array.isArray(leaversPayload.sectionEvidenceIds) ? leaversPayload.sectionEvidenceIds : [],
        management: Array.isArray(managementPayload.sectionEvidenceIds) ? managementPayload.sectionEvidenceIds : [],
      });

      if (selectedCompanyId) {
        const flagsResponse = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/company-flags?companyId=${encodeURIComponent(selectedCompanyId)}&year=${encodeURIComponent(reportingYear)}`,
          { cache: "no-store" },
        );
        const flagsPayload = await flagsResponse.json().catch(() => ({}));
        if (!flagsResponse.ok) {
          throw new Error(flagsPayload?.error || `HTTP ${flagsResponse.status}`);
        }
        setCompanyFlags({
          genderPayGapReported: Boolean(flagsPayload.genderPayGapReported),
          scope3ScreeningPerformed: Boolean(flagsPayload.scope3ScreeningPerformed),
        });
      }

      await Promise.all([loadSummary(), loadSocialCatalogData()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load social data");
    } finally {
      setLoading(false);
    }
  }, [loadSocialCatalogData, loadSummary, reportingYear, selectedCompanyId, selectedSiteId, tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadScopeData().catch((scopeError) => {
        setError(scopeError instanceof Error ? scopeError.message : "Unable to load scope data");
        setLoading(false);
      });
    }
  }, [tenant.loading, tenant.tenantId, loadScopeData]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && selectedSiteId && reportingYear) {
      void loadSiteYearData();
    }
  }, [tenant.loading, tenant.tenantId, selectedSiteId, reportingYear, loadSiteYearData]);

  const validationErrors = useMemo(() => {
    const errors = [];

    for (const contractType of CONTRACT_TYPES) {
      for (const month of MONTHS) {
        for (const gender of GENDERS) {
          const row = workforce[workforceKey(contractType, month.value, gender)];
          const headcount = toInt(row?.headcount);
          const hours = toNumber(row?.hoursWorked);
          if (headcount == null || headcount < 0) {
            errors.push(`Invalid headcount for ${contractType} ${month.label} ${gender}`);
          }
          if (hours == null || hours < 0) {
            errors.push(`Invalid hours for ${contractType} ${month.label} ${gender}`);
          }
        }
      }
    }

    for (const month of MONTHS) {
      for (const gender of GENDERS) {
        const value = toInt(leavers[leaverKey(month.value, gender)]);
        if (value == null || value < 0) {
          errors.push(`Invalid leavers for ${month.label} ${gender}`);
        }
      }
    }

    for (const gender of GENDERS) {
      const value = toInt(management[gender]);
      if (value == null || value < 0) {
        errors.push(`Invalid management headcount for ${gender}`);
      }
    }

    return errors;
  }, [leavers, management, workforce]);

  const saveAll = async () => {
    if (!tenant.tenantId || !selectedCompanyId || !selectedSiteId || !reportingYear) {
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const workforceRows = [];
      for (const contractType of CONTRACT_TYPES) {
        for (const month of MONTHS) {
          for (const gender of GENDERS) {
            const row = workforce[workforceKey(contractType, month.value, gender)];
            workforceRows.push({
              month: month.value,
              contractType,
              gender,
              headcount: toInt(row?.headcount) ?? 0,
              hoursWorked: toNumber(row?.hoursWorked) ?? 0,
            });
          }
        }
      }

      const leaverRows = [];
      for (const month of MONTHS) {
        for (const gender of GENDERS) {
          leaverRows.push({
            month: month.value,
            gender,
            leavers: toInt(leavers[leaverKey(month.value, gender)]) ?? 0,
          });
        }
      }

      const managementRows = GENDERS.map((gender) => ({
        gender,
        headcount: toInt(management[gender]) ?? 0,
      }));

      const [workforceRes, leaversRes, managementRes, flagsRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/workforce`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            siteId: selectedSiteId,
            reportingYear,
            rows: workforceRows,
            sectionEvidenceIds: sectionEvidence.workforce,
          }),
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/leavers`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            siteId: selectedSiteId,
            reportingYear,
            rows: leaverRows,
            sectionEvidenceIds: sectionEvidence.leavers,
          }),
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/management`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            siteId: selectedSiteId,
            reportingYear,
            rows: managementRows,
            sectionEvidenceIds: sectionEvidence.management,
          }),
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/company-flags`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            companyId: selectedCompanyId,
            reportingYear,
            genderPayGapReported: companyFlags.genderPayGapReported,
            scope3ScreeningPerformed: companyFlags.scope3ScreeningPerformed,
          }),
        }),
      ]);

      const [workforcePayload, leaversPayload, managementPayload, flagsPayload] = await Promise.all([
        workforceRes.json().catch(() => ({})),
        leaversRes.json().catch(() => ({})),
        managementRes.json().catch(() => ({})),
        flagsRes.json().catch(() => ({})),
      ]);

      if (!workforceRes.ok || !leaversRes.ok || !managementRes.ok || !flagsRes.ok) {
        throw new Error(
          workforcePayload?.error ||
            leaversPayload?.error ||
            managementPayload?.error ||
            flagsPayload?.error ||
            "Failed to save social data",
        );
      }

      setMessage("Social data saved successfully");
      await loadSiteYearData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save social data");
    } finally {
      setSaving(false);
    }
  };

  const saveCatalogRecords = async () => {
    if (!tenant.tenantId || !selectedCompanyId || !reportingYear) {
      return;
    }

    setSavingCatalog(true);
    setError("");
    setMessage("");

    try {
      const records = socialCatalog
        .filter((metric) => metric.method === "manual")
        .map((metric) => ({
          metricKey: metric.key,
          value: toNumber(socialRecordsByKey[metric.key]) ?? 0,
          evidenceIds: Array.isArray(socialEvidenceByKey[metric.key]) ? socialEvidenceByKey[metric.key] : [],
        }));

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/records`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          siteId: selectedSiteId || null,
          reportingYear,
          records,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }

      setMessage("Social catalog metrics saved successfully");
      await Promise.all([loadSocialCatalogData(), loadSummary()]);
    } catch (catalogError) {
      setError(catalogError instanceof Error ? catalogError.message : "Unable to save social catalog metrics");
    } finally {
      setSavingCatalog(false);
    }
  };

  const createCustomTopic = async () => {
    if (!tenant.tenantId) {
      return;
    }

    const name = String(customTopic.name || "").trim();
    const key =
      String(customTopic.key || "").trim().toLowerCase() ||
      `s_custom_${slugify(name || "metric")}`;
    const unit = String(customTopic.unit || "").trim() || "count";

    if (!name) {
      setError("Custom topic name is required");
      return;
    }

    const sdgs = String(customTopic.sdgs || "")
      .split(",")
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((item) => Number.isInteger(item) && item >= 1 && item <= 17);

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/catalog`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key,
          name,
          unit,
          method: "manual",
          groupKey: "S",
          sdgs,
          evidenceRequired: customTopic.evidenceRequired === true,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }

      setCustomTopic({
        key: "",
        name: "",
        unit: "count",
        sdgs: "",
        evidenceRequired: false,
      });
      setMessage("Custom social topic added");
      await loadSocialCatalogData();
    } catch (topicError) {
      setError(topicError instanceof Error ? topicError.message : "Unable to create custom topic");
    }
  };

  const updateSectionEvidence = (section, values) => {
    setSectionEvidence((current) => ({
      ...current,
      [section]: values,
    }));
  };

  const retryLoad = () => {
    if (!tenant.tenantId) {
      return;
    }
    if (selectedSiteId && reportingYear) {
      void loadSiteYearData();
      return;
    }
    void loadScopeData().catch((scopeError) => {
      setError(scopeError instanceof Error ? scopeError.message : "Unable to load scope data");
    });
  };

  const manualSocialMetrics = useMemo(
    () => socialCatalog.filter((metric) => metric.method === "manual"),
    [socialCatalog],
  );
  const computedSocialMetrics = useMemo(
    () => socialCatalog.filter((metric) => metric.method === "computed"),
    [socialCatalog],
  );

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Social Data</h2>
          <p className="enterprise-muted">Monthly workforce, leavers and annual management with computed KPIs.</p>
        </div>
        <div className="enterprise-inline-actions">
          <Link className="enterprise-button-secondary" href="/app/definitions?type=social">
            Manage fields
          </Link>
        </div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <label className="enterprise-label" htmlFor="social-year">
            <TooltipText text="Anno di reporting">Reporting year</TooltipText>
          </label>
          <input
            id="social-year"
            className="enterprise-input"
            type="number"
            min="1900"
            max="2200"
            value={reportingYear}
            onChange={(event) => setReportingYear(Number(event.target.value))}
          />

          <label className="enterprise-label" htmlFor="social-company">
            Company
          </label>
          <select
            id="social-company"
            className="enterprise-input"
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              companyScope.setActiveCompanyId(event.target.value);
              setSelectedSiteId("");
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

          <label className="enterprise-label" htmlFor="social-site">
            Site
          </label>
          <select
            id="social-site"
            className="enterprise-input"
            value={selectedSiteId}
            onChange={(event) => setSelectedSiteId(event.target.value)}
          >
            <option value="">Select site</option>
            {sites
              .filter((site) => !selectedCompanyId || site.companyId === selectedCompanyId)
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {error ? (
        <div className="enterprise-status enterprise-status-error">
          <span>{error}</span>
          <span> </span>
          <button className="enterprise-button-secondary" type="button" onClick={retryLoad}>
            Retry
          </button>
        </div>
      ) : null}
      {message ? <p className="enterprise-status">{message}</p> : null}

      {validationErrors.length > 0 ? (
        <div className="enterprise-warning">Validation issues detected. Fix invalid non-negative values before saving.</div>
      ) : null}

      {selectedSiteId && loading ? <p className="enterprise-status">Loading social data...</p> : null}

      {!loading && selectedCompanyId && !selectedSiteId ? (
        <>
          <div className="enterprise-empty">Select a site to load social data</div>
          <div className="enterprise-inline-actions">
            <button className="enterprise-button-secondary" type="button" onClick={retryLoad}>
              Retry
            </button>
            <button className="enterprise-button-primary" type="button" disabled>
              Save social data
            </button>
          </div>
        </>
      ) : null}

      {!loading && selectedSiteId ? (
        <>
          {CONTRACT_TYPES.map((contractType) => (
            <div className="enterprise-table-wrap" key={contractType}>
              <table className="enterprise-table enterprise-table-wide">
                <thead>
                  <tr>
                    <th colSpan={8}>
                      <TooltipText text="Organico mensile">Workforce: {contractType}</TooltipText>
                    </th>
                  </tr>
                  <tr>
                    <th>Month</th>
                    <th>M Headcount</th>
                    <th>M Hours</th>
                    <th>F Headcount</th>
                    <th>F Hours</th>
                    <th>D Headcount</th>
                    <th>D Hours</th>
                    <th>Section evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((month, index) => (
                    <tr key={`${contractType}-${month.value}`}>
                      <td>{month.label}</td>
                      {GENDERS.map((gender) => {
                        const row = workforce[workforceKey(contractType, month.value, gender)] || {
                          headcount: "0",
                          hoursWorked: "0",
                        };
                        return (
                          <>
                            <td key={`${contractType}-${month.value}-${gender}-headcount`}>
                              <input
                                className="enterprise-input"
                                type="number"
                                min="0"
                                value={row.headcount}
                                onChange={(event) =>
                                  setWorkforce((current) => ({
                                    ...current,
                                    [workforceKey(contractType, month.value, gender)]: {
                                      ...current[workforceKey(contractType, month.value, gender)],
                                      headcount: event.target.value,
                                    },
                                  }))
                                }
                                disabled={!canWrite}
                              />
                            </td>
                            <td key={`${contractType}-${month.value}-${gender}-hours`}>
                              <input
                                className="enterprise-input"
                                type="number"
                                step="any"
                                min="0"
                                value={row.hoursWorked}
                                onChange={(event) =>
                                  setWorkforce((current) => ({
                                    ...current,
                                    [workforceKey(contractType, month.value, gender)]: {
                                      ...current[workforceKey(contractType, month.value, gender)],
                                      hoursWorked: event.target.value,
                                    },
                                  }))
                                }
                                disabled={!canWrite}
                              />
                            </td>
                          </>
                        );
                      })}
                      {index === 0 ? (
                        <td rowSpan={12}>
                          <select
                            className="enterprise-input"
                            multiple
                            value={sectionEvidence.workforce}
                            onChange={(event) =>
                              updateSectionEvidence(
                                "workforce",
                                [...event.target.selectedOptions].map((option) => option.value),
                              )
                            }
                            disabled={!canWrite}
                          >
                            {evidence.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.filename}
                              </option>
                            ))}
                          </select>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div className="enterprise-table-wrap">
            <table className="enterprise-table enterprise-table-wide">
              <thead>
                <tr>
                  <th colSpan={5}>
                    <TooltipText text="Persone uscite">Leavers</TooltipText>
                  </th>
                </tr>
                <tr>
                  <th>Month</th>
                  <th>M</th>
                  <th>F</th>
                  <th>D</th>
                  <th>Section evidence</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((month, index) => (
                  <tr key={`leaver-${month.value}`}>
                    <td>{month.label}</td>
                    {GENDERS.map((gender) => (
                      <td key={`leaver-${month.value}-${gender}`}>
                        <input
                          className="enterprise-input"
                          type="number"
                          min="0"
                          value={leavers[leaverKey(month.value, gender)]}
                          onChange={(event) =>
                            setLeavers((current) => ({
                              ...current,
                              [leaverKey(month.value, gender)]: event.target.value,
                            }))
                          }
                          disabled={!canWrite}
                        />
                      </td>
                    ))}
                    {index === 0 ? (
                      <td rowSpan={12}>
                        <select
                          className="enterprise-input"
                          multiple
                          value={sectionEvidence.leavers}
                          onChange={(event) =>
                            updateSectionEvidence(
                              "leavers",
                              [...event.target.selectedOptions].map((option) => option.value),
                            )
                          }
                          disabled={!canWrite}
                        >
                          {evidence.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.filename}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="enterprise-table-wrap">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th colSpan={3}>
                    <TooltipText text="Dati manageriali">Management (year-end)</TooltipText>
                  </th>
                </tr>
                <tr>
                  <th>Gender</th>
                  <th>Headcount</th>
                  <th>Section evidence</th>
                </tr>
              </thead>
              <tbody>
                {GENDERS.map((gender, index) => (
                  <tr key={`mgmt-${gender}`}>
                    <td>{gender}</td>
                    <td>
                      <input
                        className="enterprise-input"
                        type="number"
                        min="0"
                        value={management[gender]}
                        onChange={(event) =>
                          setManagement((current) => ({
                            ...current,
                            [gender]: event.target.value,
                          }))
                        }
                        disabled={!canWrite}
                      />
                    </td>
                    {index === 0 ? (
                      <td rowSpan={3}>
                        <select
                          className="enterprise-input"
                          multiple
                          value={sectionEvidence.management}
                          onChange={(event) =>
                            updateSectionEvidence(
                              "management",
                              [...event.target.selectedOptions].map((option) => option.value),
                            )
                          }
                          disabled={!canWrite}
                        >
                          {evidence.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.filename}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="enterprise-card">
            <h3>Company Flags</h3>
            <div className="enterprise-inline-actions">
              <label className="enterprise-checkbox-row" htmlFor="flag-pay-gap">
                <input
                  id="flag-pay-gap"
                  type="checkbox"
                  checked={companyFlags.genderPayGapReported}
                  onChange={(event) =>
                    setCompanyFlags((current) => ({
                      ...current,
                      genderPayGapReported: event.target.checked,
                    }))
                  }
                  disabled={!canWrite}
                />
                <span>Gender pay gap reported</span>
              </label>

              <label className="enterprise-checkbox-row" htmlFor="flag-scope3">
                <input
                  id="flag-scope3"
                  type="checkbox"
                  checked={companyFlags.scope3ScreeningPerformed}
                  onChange={(event) =>
                    setCompanyFlags((current) => ({
                      ...current,
                      scope3ScreeningPerformed: event.target.checked,
                    }))
                  }
                  disabled={!canWrite}
                />
                <span>Scope 3 screening performed</span>
              </label>
            </div>
          </div>

          <div className="enterprise-card">
            <h3>Social catalog (definition-driven)</h3>
            <p className="enterprise-muted">Manual and computed KPIs are driven by `social_metric_definitions` and scoped by company/site/year.</p>

            {manualSocialMetrics.length > 0 ? (
              <div className="enterprise-table-wrap">
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>
                        <TooltipText text="Indicatore ambientale">Metric</TooltipText>
                      </th>
                      <th>
                        <TooltipText text="Unità di misura">Unit</TooltipText>
                      </th>
                      <th>SDGs</th>
                      <th>
                        <TooltipText text="Inserisci il valore">Value</TooltipText>
                      </th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualSocialMetrics.map((metric) => (
                      <tr key={metric.key}>
                        <td>{metric.name}</td>
                        <td>{metric.unit}</td>
                        <td>
                          {Array.isArray(metric.sdgs) && metric.sdgs.length > 0
                            ? metric.sdgs.map((sdg) => (
                                <span key={`${metric.key}-sdg-${sdg}`} className="enterprise-chip">
                                  SDG {sdg}
                                </span>
                              ))
                            : "-"}
                        </td>
                        <td>
                          <input
                            className="enterprise-input"
                            type="number"
                            step="any"
                            min="0"
                            value={socialRecordsByKey[metric.key] ?? "0"}
                            onChange={(event) =>
                              setSocialRecordsByKey((current) => ({
                                ...current,
                                [metric.key]: event.target.value,
                              }))
                            }
                            disabled={!canWrite}
                          />
                        </td>
                        <td>
                          <select
                            className="enterprise-input"
                            multiple
                            value={socialEvidenceByKey[metric.key] || []}
                            onChange={(event) =>
                              setSocialEvidenceByKey((current) => ({
                                ...current,
                                [metric.key]: [...event.target.selectedOptions].map((option) => option.value),
                              }))
                            }
                            disabled={!canWrite}
                          >
                            {evidence.map((item) => (
                              <option key={`${metric.key}-${item.id}`} value={item.id}>
                                {item.filename}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="enterprise-empty">No manual social metrics active for this tenant.</div>
            )}

            {computedSocialMetrics.length > 0 ? (
              <div className="enterprise-kpi-grid">
                {computedSocialMetrics.map((metric) => (
                  <article key={metric.key} className="enterprise-kpi-card">
                    <strong>{metric.name}</strong>
                    <p>{socialComputed?.values?.[metric.key] ?? 0}</p>
                    <small>{metric.unit}</small>
                    <div>
                      {Array.isArray(metric.sdgs) && metric.sdgs.length > 0
                        ? metric.sdgs.map((sdg) => (
                            <span key={`${metric.key}-computed-sdg-${sdg}`} className="enterprise-chip">
                              SDG {sdg}
                            </span>
                          ))
                        : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-secondary" type="button" onClick={() => void loadSocialCatalogData()}>
                Refresh social catalog
              </button>
              <button
                className="enterprise-button-primary"
                type="button"
                onClick={() => void saveCatalogRecords()}
                disabled={!canWrite || savingCatalog}
              >
                {savingCatalog ? "Saving..." : "Save social topics"}
              </button>
            </div>
          </div>

          <div className="enterprise-card">
            <h3>Add social topic</h3>
            <div className="enterprise-filter-grid">
              <label className="enterprise-label" htmlFor="social-topic-name">
                Name
              </label>
              <input
                id="social-topic-name"
                className="enterprise-input"
                type="text"
                value={customTopic.name}
                onChange={(event) => setCustomTopic((current) => ({ ...current, name: event.target.value }))}
                disabled={!canWrite}
              />

              <label className="enterprise-label" htmlFor="social-topic-key">
                Key (optional)
              </label>
              <input
                id="social-topic-key"
                className="enterprise-input"
                type="text"
                value={customTopic.key}
                onChange={(event) => setCustomTopic((current) => ({ ...current, key: slugify(event.target.value) }))}
                placeholder="s_custom_my_topic"
                disabled={!canWrite}
              />

              <label className="enterprise-label" htmlFor="social-topic-unit">
                Unit
              </label>
              <input
                id="social-topic-unit"
                className="enterprise-input"
                type="text"
                value={customTopic.unit}
                onChange={(event) => setCustomTopic((current) => ({ ...current, unit: event.target.value }))}
                disabled={!canWrite}
              />

              <label className="enterprise-label" htmlFor="social-topic-sdgs">
                SDGs (comma-separated)
              </label>
              <input
                id="social-topic-sdgs"
                className="enterprise-input"
                type="text"
                value={customTopic.sdgs}
                onChange={(event) => setCustomTopic((current) => ({ ...current, sdgs: event.target.value }))}
                placeholder="3,5,8"
                disabled={!canWrite}
              />
            </div>
            <div className="enterprise-inline-actions">
              <label className="enterprise-checkbox-row" htmlFor="social-topic-evidence">
                <input
                  id="social-topic-evidence"
                  type="checkbox"
                  checked={customTopic.evidenceRequired}
                  onChange={(event) =>
                    setCustomTopic((current) => ({
                      ...current,
                      evidenceRequired: event.target.checked,
                    }))
                  }
                  disabled={!canWrite}
                />
                <span>Evidence required</span>
              </label>
              <button className="enterprise-button-primary" type="button" onClick={() => void createCustomTopic()} disabled={!canWrite}>
                Add social topic
              </button>
            </div>
          </div>

          <div className="enterprise-card">
            <h3>
              <TooltipText text="KPI calcolati">Computed KPIs (read-only)</TooltipText>
            </h3>
            {siteSummary ? (
              <div className="enterprise-kpi-grid">
                <article className="enterprise-kpi-card">
                  <strong>Total employees year-end</strong>
                  <p>{siteSummary.totalEmployeesYearEnd}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>
                    <TooltipText text="Contratti stabili">Permanent year-end</TooltipText>
                  </strong>
                  <p>{siteSummary.permanentEmployeesYearEnd}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>
                    <TooltipText text="Contratti temporanei">Temporary year-end</TooltipText>
                  </strong>
                  <p>{siteSummary.temporaryEmployeesYearEnd}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>
                    <TooltipText text="Presenza femminile">Women in workforce %</TooltipText>
                  </strong>
                  <p>{siteSummary.womenInWorkforcePct?.toFixed?.(2) ?? siteSummary.womenInWorkforcePct}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>
                    <TooltipText text="Donne nel management">Women in management %</TooltipText>
                  </strong>
                  <p>{siteSummary.womenInManagementPct?.toFixed?.(2) ?? siteSummary.womenInManagementPct}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>
                    <TooltipText text="Tasso di turnover">Turnover %</TooltipText>
                  </strong>
                  <p>{siteSummary.turnoverPct?.toFixed?.(2) ?? siteSummary.turnoverPct}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Total hours worked</strong>
                  <p>{siteSummary.hoursWorkedTotal}</p>
                </article>
              </div>
            ) : (
              <div className="enterprise-empty">No computed social summary available for this site/year.</div>
            )}
            {companySummary ? (
              <p className="enterprise-muted">
                Company aggregate women% {companySummary.womenInWorkforcePct?.toFixed?.(2) ?? companySummary.womenInWorkforcePct}
                , turnover {companySummary.turnoverPct?.toFixed?.(2) ?? companySummary.turnoverPct}
              </p>
            ) : null}
          </div>

          <div className="enterprise-inline-actions">
            <button className="enterprise-button-secondary" type="button" onClick={() => void loadSiteYearData()}>
              Refresh
            </button>
            <button
              className="enterprise-button-primary"
              type="button"
              disabled={!canWrite || saving || validationErrors.length > 0}
              onClick={() => void saveAll()}
            >
              {saving ? "Saving..." : "Save social data"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
