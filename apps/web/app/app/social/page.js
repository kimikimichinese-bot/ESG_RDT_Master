"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setSelectedCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

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

      await loadSummary();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load social data");
    } finally {
      setLoading(false);
    }
  }, [loadSummary, reportingYear, selectedCompanyId, selectedSiteId, tenant.tenantId]);

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

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Social Data</h2>
          <p className="enterprise-muted">Monthly workforce, leavers and annual management with computed KPIs.</p>
        </div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <label className="enterprise-label" htmlFor="social-year">
            Reporting year
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
                    <th colSpan={8}>Workforce: {contractType}</th>
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
                  <th colSpan={5}>Leavers</th>
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
                  <th colSpan={3}>Management (year-end)</th>
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
            <h3>Computed KPIs (read-only)</h3>
            {siteSummary ? (
              <div className="enterprise-kpi-grid">
                <article className="enterprise-kpi-card">
                  <strong>Total employees year-end</strong>
                  <p>{siteSummary.totalEmployeesYearEnd}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Permanent year-end</strong>
                  <p>{siteSummary.permanentEmployeesYearEnd}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Temporary year-end</strong>
                  <p>{siteSummary.temporaryEmployeesYearEnd}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Women in workforce %</strong>
                  <p>{siteSummary.womenInWorkforcePct?.toFixed?.(2) ?? siteSummary.womenInWorkforcePct}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Women in management %</strong>
                  <p>{siteSummary.womenInManagementPct?.toFixed?.(2) ?? siteSummary.womenInManagementPct}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Turnover %</strong>
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
