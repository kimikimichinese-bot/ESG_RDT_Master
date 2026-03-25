"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useTenantSession } from "../_components/use-tenant-session";
import { useCompanyScope } from "../_components/use-company-scope";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const emptyForm = {
  name: "",
  legalName: "",
  country: "",
  isHolding: false,
};

const emptyCustomField = {
  defType: "environment_metric",
  key: "",
  name: "",
  unit: "",
  category: "Custom",
  scope: "scope3",
  method: "activity",
};

const DEF_TYPE_LABELS = {
  environment_metric: "Environment metrics",
  ghg_activity: "GHG activities",
  social_metric: "Social metrics",
  governance_field: "Governance fields",
};

const DEF_TYPE_API_PATH = {
  environment_metric: "environment",
  ghg_activity: "ghg",
  social_metric: "social",
  governance_field: "governance",
};

const toApiError = (payload, status) =>
  payload?.message || payload?.error || payload?.code || `HTTP ${status || 500}`;

export default function CompaniesPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [standardsCompanyId, setStandardsCompanyId] = useState("");
  const [standardsLoading, setStandardsLoading] = useState(false);
  const [standardsSaving, setStandardsSaving] = useState(false);
  const [standardsError, setStandardsError] = useState("");
  const [standardsMessage, setStandardsMessage] = useState("");
  const [standardsProfile, setStandardsProfile] = useState({
    industryFramework: "GRI",
    sasbIndustryCode: "",
    region: "",
    country: "",
  });
  const [definitionsByType, setDefinitionsByType] = useState({
    environment_metric: [],
    ghg_activity: [],
    social_metric: [],
    governance_field: [],
  });
  const [customField, setCustomField] = useState(emptyCustomField);
  const [customFieldEditingKey, setCustomFieldEditingKey] = useState("");

  const canWrite = useMemo(() => tenant.role === "TenantAdmin" || tenant.role === "Manager", [tenant.role]);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setStandardsCompanyId(companyScope.activeCompanyId);
      return;
    }
    if (!standardsCompanyId && companyScope.companies.length > 0) {
      setStandardsCompanyId(companyScope.companies[0].id);
    }
  }, [companyScope.activeCompanyId, companyScope.companies, standardsCompanyId]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (company) => {
    setEditing(company);
    setForm({
      name: company.name || "",
      legalName: company.legalName || "",
      country: company.country || "",
      isHolding: Boolean(company.isHolding),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const loadStandardsConfig = useCallback(
    async (companyId) => {
      if (!tenant.tenantId || !companyId) {
        return;
      }

      setStandardsLoading(true);
      setStandardsError("");

      try {
        const response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/standards/company/${encodeURIComponent(companyId)}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw new Error(toApiError(payload, response.status));
        }

        const profile = payload.profile || {};
        setStandardsProfile({
          industryFramework: profile.industryFramework || "GRI",
          sasbIndustryCode: profile.sasbIndustryCode || "",
          region: profile.region || "",
          country: profile.country || "",
        });

        const definitions = payload.definitions || {};
        setDefinitionsByType({
          environment_metric: Array.isArray(definitions.environment_metric) ? definitions.environment_metric : [],
          ghg_activity: Array.isArray(definitions.ghg_activity) ? definitions.ghg_activity : [],
          social_metric: Array.isArray(definitions.social_metric) ? definitions.social_metric : [],
          governance_field: Array.isArray(definitions.governance_field) ? definitions.governance_field : [],
        });
      } catch (loadError) {
        setStandardsError(loadError instanceof Error ? loadError.message : "Unable to load standards configuration");
      } finally {
        setStandardsLoading(false);
      }
    },
    [tenant.tenantId],
  );

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && standardsCompanyId) {
      void loadStandardsConfig(standardsCompanyId);
    }
  }, [tenant.loading, tenant.tenantId, standardsCompanyId, loadStandardsConfig]);

  const onSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (!tenant.tenantId) {
        return;
      }

      setSaving(true);
      setError("");

      try {
        const url = editing
          ? `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/companies/${encodeURIComponent(editing.id)}`
          : `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/companies`;

        const response = await fetch(url, {
          method: editing ? "PUT" : "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(form),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        closeModal();
        await companyScope.refresh();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Unable to save company");
      } finally {
        setSaving(false);
      }
    },
    [companyScope, editing, form, tenant.tenantId],
  );

  const onDelete = useCallback(
    async (company) => {
      if (!tenant.tenantId) {
        return;
      }
      const confirmed = window.confirm(`Delete company "${company.name}"?`);
      if (!confirmed) {
        return;
      }

      setError("");
      try {
        const response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/companies/${encodeURIComponent(company.id)}`,
          { method: "DELETE" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        await companyScope.refresh();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Unable to delete company");
      }
    },
    [companyScope, tenant.tenantId],
  );

  const toggleDefinition = useCallback((defType, defKey, field, value) => {
    setDefinitionsByType((current) => ({
      ...current,
      [defType]: (current[defType] || []).map((item) =>
        item.key === defKey
          ? {
              ...item,
              [field]: value,
            }
          : item,
      ),
    }));
  }, []);

  const saveStandardsProfile = useCallback(async () => {
    if (!tenant.tenantId || !standardsCompanyId || !canWrite) {
      return;
    }

    setStandardsSaving(true);
    setStandardsError("");
    setStandardsMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/standards/company/${encodeURIComponent(standardsCompanyId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile: standardsProfile }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(toApiError(payload, response.status));
      }

      setStandardsMessage("Company profile updated.");
      await loadStandardsConfig(standardsCompanyId);
    } catch (saveError) {
      setStandardsError(saveError instanceof Error ? saveError.message : "Unable to save standards profile");
    } finally {
      setStandardsSaving(false);
    }
  }, [canWrite, loadStandardsConfig, standardsCompanyId, standardsProfile, tenant.tenantId]);

  const saveEnabledDefinitions = useCallback(async () => {
    if (!tenant.tenantId || !standardsCompanyId || !canWrite) {
      return;
    }

    setStandardsSaving(true);
    setStandardsError("");
    setStandardsMessage("");

    try {
      const enabledDefinitions = Object.entries(definitionsByType).flatMap(([defType, rows]) =>
        (Array.isArray(rows) ? rows : []).map((item) => ({
          defType,
          defKey: item.key,
          enabled: item.enabled !== false,
          required: item.required === true,
        })),
      );

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/standards/company/${encodeURIComponent(standardsCompanyId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabledDefinitions }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(toApiError(payload, response.status));
      }

      setStandardsMessage("Enabled fields updated.");
      await loadStandardsConfig(standardsCompanyId);
    } catch (saveError) {
      setStandardsError(saveError instanceof Error ? saveError.message : "Unable to save enabled definitions");
    } finally {
      setStandardsSaving(false);
    }
  }, [canWrite, definitionsByType, loadStandardsConfig, standardsCompanyId, tenant.tenantId]);

  const applyRecommended = useCallback(async () => {
    if (!tenant.tenantId || !standardsCompanyId || !canWrite) {
      return;
    }

    setStandardsSaving(true);
    setStandardsError("");
    setStandardsMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/standards/company/${encodeURIComponent(standardsCompanyId)}/recommended`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            framework: standardsProfile.industryFramework,
            sasbIndustryCode: standardsProfile.sasbIndustryCode,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(toApiError(payload, response.status));
      }

      setStandardsMessage(`Recommended set applied (${payload?.result?.enabledCount || 0} fields).`);
      await loadStandardsConfig(standardsCompanyId);
    } catch (applyError) {
      setStandardsError(applyError instanceof Error ? applyError.message : "Unable to apply recommended set");
    } finally {
      setStandardsSaving(false);
    }
  }, [canWrite, loadStandardsConfig, standardsCompanyId, standardsProfile.industryFramework, standardsProfile.sasbIndustryCode, tenant.tenantId]);

  const createCustomField = useCallback(async () => {
    if (!tenant.tenantId || !standardsCompanyId || !canWrite) {
      return;
    }

    setStandardsSaving(true);
    setStandardsError("");
    setStandardsMessage("");

    try {
      const apiType = DEF_TYPE_API_PATH[customField.defType];
      if (!apiType) {
        throw new Error("Invalid definition type");
      }
      const requestBody = {
        key: customField.key,
        name: customField.name,
        unit: customField.unit,
      };
      if (customField.defType === "environment_metric") {
        requestBody.category = customField.category;
      } else if (customField.defType === "ghg_activity") {
        requestBody.scope = customField.scope;
        requestBody.method = customField.method;
      } else if (customField.defType === "social_metric") {
        requestBody.method = "manual";
      } else if (customField.defType === "governance_field") {
        requestBody.fieldType = "text";
      }

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/definitions/${apiType}`, {
        method: customFieldEditingKey ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok || responseBody?.ok === false) {
        throw new Error(toApiError(responseBody, response.status));
      }

      setStandardsMessage(
        customFieldEditingKey
          ? `Custom field updated: ${responseBody?.definition?.key || customField.key}`
          : `Custom field created: ${responseBody?.definition?.key || customField.key}`,
      );
      setCustomField(emptyCustomField);
      setCustomFieldEditingKey("");
      await loadStandardsConfig(standardsCompanyId);
    } catch (createError) {
      setStandardsError(createError instanceof Error ? createError.message : "Unable to create custom field");
    } finally {
      setStandardsSaving(false);
    }
  }, [canWrite, customField, customFieldEditingKey, loadStandardsConfig, standardsCompanyId, tenant.tenantId]);

  const editCustomField = useCallback((defType, item) => {
    setCustomFieldEditingKey(item.key);
    setCustomField({
      defType,
      key: item.key || "",
      name: item.name || item.label || "",
      unit: item.unit || "",
      category: item.category || "Custom",
      scope: item.scope || "scope3",
      method: item.method || "activity",
    });
  }, []);

  const deleteCustomField = useCallback(
    async (defType, item) => {
      if (!tenant.tenantId || !canWrite) {
        return;
      }
      const apiType = DEF_TYPE_API_PATH[defType];
      if (!apiType) {
        return;
      }
      const confirmed = window.confirm(`Delete custom definition "${item.key}"?`);
      if (!confirmed) {
        return;
      }

      setStandardsSaving(true);
      setStandardsError("");
      setStandardsMessage("");
      try {
        const response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/definitions/${apiType}?key=${encodeURIComponent(item.key)}`,
          { method: "DELETE" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw new Error(toApiError(payload, response.status));
        }
        if (customFieldEditingKey === item.key) {
          setCustomFieldEditingKey("");
          setCustomField(emptyCustomField);
        }
        setStandardsMessage(`Deleted ${item.key}`);
        await loadStandardsConfig(standardsCompanyId);
      } catch (deleteError) {
        setStandardsError(deleteError instanceof Error ? deleteError.message : "Unable to delete custom field");
      } finally {
        setStandardsSaving(false);
      }
    },
    [canWrite, customFieldEditingKey, loadStandardsConfig, standardsCompanyId, tenant.tenantId],
  );

  const disableSystemDefinition = useCallback(
    async (defType, item) => {
      if (!tenant.tenantId || !canWrite) {
        return;
      }
      const apiType = DEF_TYPE_API_PATH[defType];
      if (!apiType) {
        return;
      }
      setStandardsSaving(true);
      setStandardsError("");
      setStandardsMessage("");
      try {
        const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/definitions/${apiType}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: item.key, isActive: false }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw new Error(toApiError(payload, response.status));
        }
        setStandardsMessage(`Disabled ${item.key}`);
        await loadStandardsConfig(standardsCompanyId);
      } catch (disableError) {
        setStandardsError(disableError instanceof Error ? disableError.message : "Unable to disable definition");
      } finally {
        setStandardsSaving(false);
      }
    },
    [canWrite, loadStandardsConfig, standardsCompanyId, tenant.tenantId],
  );

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Companies</h2>
          <p className="enterprise-muted">Tenant holding and operating companies registry.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void companyScope.refresh()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={openCreate}>
              New company
            </button>
          ) : null}
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {companyScope.loading ? <p className="enterprise-status">Loading companies...</p> : null}

      {!companyScope.loading && companyScope.companies.length === 0 ? (
        <div className="enterprise-empty">No companies found for this tenant.</div>
      ) : null}

      {!companyScope.loading && companyScope.companies.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Legal name</th>
                <th>Country</th>
                <th>Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {companyScope.companies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.legalName || "-"}</td>
                  <td>{company.country || "-"}</td>
                  <td>
                    {company.isHolding ? (
                      <span className="enterprise-pill enterprise-tooltip" data-tooltip="Società capogruppo" aria-label="Società capogruppo">
                        Holding
                      </span>
                    ) : (
                      <span className="enterprise-tooltip" data-tooltip="Società operativa" aria-label="Società operativa">
                        Operating
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="enterprise-inline-actions">
                      {canWrite ? (
                        <>
                          <button className="enterprise-button-secondary" type="button" onClick={() => openEdit(company)}>
                            Edit
                          </button>
                          <button
                            className="enterprise-button-danger"
                            type="button"
                            onClick={() => void onDelete(company)}
                            disabled={company.isHolding}
                            title={company.isHolding ? "Holding company cannot be deleted" : "Delete company"}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <span className="enterprise-muted">Read-only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="enterprise-card">
        <div className="enterprise-toolbar">
          <div>
            <h3 style={{ margin: 0 }}>
              <TooltipText text="Campi per company">Standards &amp; Fields</TooltipText>
            </h3>
            <p className="enterprise-muted">Select framework/profile and enable internal fields per company.</p>
          </div>
          <div className="enterprise-inline-actions">
            <select
              className="enterprise-input"
              value={standardsCompanyId}
              onChange={(event) => setStandardsCompanyId(event.target.value)}
            >
              <option value="">Select company</option>
              {companyScope.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <button
              className="enterprise-button-secondary"
              type="button"
              onClick={() => void loadStandardsConfig(standardsCompanyId)}
              disabled={!standardsCompanyId || standardsLoading}
            >
              {standardsLoading ? "Loading..." : "Reload"}
            </button>
          </div>
        </div>

        {standardsError ? <p className="enterprise-status enterprise-status-error">{standardsError}</p> : null}
        {standardsMessage ? <p className="enterprise-status enterprise-status-ok">{standardsMessage}</p> : null}

        {standardsCompanyId ? (
          <div className="enterprise-grid" style={{ marginTop: 8 }}>
            <div className="enterprise-card-grid">
              <div className="enterprise-subcard">
                <h4 style={{ marginTop: 0 }}>
                  <TooltipText text="Profilo settoriale">Company profile</TooltipText>
                </h4>
                <div className="enterprise-form-grid">
                  <label className="enterprise-label" htmlFor="company-framework">
                    <TooltipText text="Standard attivi">Framework</TooltipText>
                  </label>
                  <select
                    id="company-framework"
                    className="enterprise-input"
                    value={standardsProfile.industryFramework}
                    onChange={(event) =>
                      setStandardsProfile((current) => ({
                        ...current,
                        industryFramework: event.target.value,
                      }))
                    }
                    disabled={!canWrite}
                  >
                    <option value="GRI">GRI</option>
                    <option value="SASB">SASB</option>
                  </select>

                  <label className="enterprise-label" htmlFor="company-sasb-code">SASB industry code</label>
                  <input
                    id="company-sasb-code"
                    className="enterprise-input"
                    value={standardsProfile.sasbIndustryCode}
                    onChange={(event) =>
                      setStandardsProfile((current) => ({
                        ...current,
                        sasbIndustryCode: event.target.value,
                      }))
                    }
                    disabled={!canWrite}
                  />

                  <label className="enterprise-label" htmlFor="company-region">Region</label>
                  <input
                    id="company-region"
                    className="enterprise-input"
                    value={standardsProfile.region}
                    onChange={(event) => setStandardsProfile((current) => ({ ...current, region: event.target.value }))}
                    disabled={!canWrite}
                  />

                  <label className="enterprise-label" htmlFor="company-country-profile">Country</label>
                  <input
                    id="company-country-profile"
                    className="enterprise-input"
                    value={standardsProfile.country}
                    onChange={(event) => setStandardsProfile((current) => ({ ...current, country: event.target.value }))}
                    disabled={!canWrite}
                  />
                </div>

                <div className="enterprise-inline-actions" style={{ marginTop: 10 }}>
                  <button
                    className="enterprise-button-primary"
                    type="button"
                    onClick={() => void saveStandardsProfile()}
                    disabled={!canWrite || standardsSaving}
                  >
                    Save profile
                  </button>
                  <button
                    className="enterprise-button-secondary"
                    type="button"
                    onClick={() => void applyRecommended()}
                    disabled={!canWrite || standardsSaving}
                  >
                    <TooltipText text="Campi consigliati">Apply recommended set</TooltipText>
                  </button>
                </div>
              </div>

              <div className="enterprise-subcard">
                <h4 style={{ marginTop: 0 }}>{customFieldEditingKey ? `Edit custom field (${customFieldEditingKey})` : "Add custom field"}</h4>
                <div className="enterprise-form-grid">
                  <label className="enterprise-label" htmlFor="custom-def-type">Type</label>
                  <select
                    id="custom-def-type"
                    className="enterprise-input"
                    value={customField.defType}
                    onChange={(event) => setCustomField((current) => ({ ...current, defType: event.target.value }))}
                    disabled={!canWrite}
                  >
                    <option value="environment_metric">Environment metric</option>
                    <option value="ghg_activity">GHG activity</option>
                    <option value="social_metric">Social metric</option>
                    <option value="governance_field">Governance field</option>
                  </select>

                  <label className="enterprise-label" htmlFor="custom-def-name">Name</label>
                  <input
                    id="custom-def-name"
                    className="enterprise-input"
                    value={customField.name}
                    onChange={(event) => setCustomField((current) => ({ ...current, name: event.target.value }))}
                    disabled={!canWrite}
                  />

                  <label className="enterprise-label" htmlFor="custom-def-key">Key (optional)</label>
                  <input
                    id="custom-def-key"
                    className="enterprise-input"
                    value={customField.key}
                    onChange={(event) => setCustomField((current) => ({ ...current, key: event.target.value }))}
                    disabled={!canWrite || Boolean(customFieldEditingKey)}
                  />

                  <label className="enterprise-label" htmlFor="custom-def-unit">Unit</label>
                  <input
                    id="custom-def-unit"
                    className="enterprise-input"
                    value={customField.unit}
                    onChange={(event) => setCustomField((current) => ({ ...current, unit: event.target.value }))}
                    disabled={!canWrite}
                  />

                  <label className="enterprise-label" htmlFor="custom-def-category">Category/Sub-group</label>
                  <input
                    id="custom-def-category"
                    className="enterprise-input"
                    value={customField.category}
                    onChange={(event) => setCustomField((current) => ({ ...current, category: event.target.value }))}
                    disabled={!canWrite}
                  />
                </div>

                <div className="enterprise-inline-actions" style={{ marginTop: 10 }}>
                  <button
                    className="enterprise-button-primary"
                    type="button"
                    onClick={() => void createCustomField()}
                    disabled={!canWrite || standardsSaving}
                  >
                    {customFieldEditingKey ? "Save custom field" : "Add custom field"}
                  </button>
                  {customFieldEditingKey ? (
                    <button
                      className="enterprise-button-secondary"
                      type="button"
                      onClick={() => {
                        setCustomFieldEditingKey("");
                        setCustomField(emptyCustomField);
                      }}
                      disabled={standardsSaving}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="enterprise-subcard">
              <h4 style={{ marginTop: 0 }}>Enabled fields by type</h4>
              <p className="enterprise-muted">Toggle what appears in data-entry modules for this company.</p>

              {Object.entries(DEF_TYPE_LABELS).map(([defType, label]) => (
                <div key={defType} style={{ marginTop: 12 }}>
                  <p style={{ margin: "0 0 6px" }}>
                    <strong>{label}</strong>
                  </p>
                  {(definitionsByType[defType] || []).length === 0 ? (
                    <p className="enterprise-muted">No definitions available.</p>
                  ) : (
                    <div className="enterprise-table-wrap">
                      <table className="enterprise-table">
                        <thead>
                          <tr>
                            <th>Key</th>
                            <th>Name</th>
                            <th>Unit</th>
                            <th>Enabled</th>
                            <th>Required</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(definitionsByType[defType] || []).map((item) => (
                            <tr key={`${defType}:${item.key}`}>
                              <td>{item.key}</td>
                              <td>{item.name || item.label || item.key}</td>
                              <td>{item.unit || "-"}</td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={item.enabled !== false}
                                  onChange={(event) =>
                                    toggleDefinition(defType, item.key, "enabled", event.target.checked)
                                  }
                                  disabled={!canWrite}
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={item.required === true}
                                  onChange={(event) =>
                                    toggleDefinition(defType, item.key, "required", event.target.checked)
                                  }
                                  disabled={!canWrite}
                                />
                              </td>
                              <td>
                                <div className="enterprise-inline-actions">
                                  {item.isSystem === false || item.custom === true ? (
                                    <>
                                      <button
                                        className="enterprise-button-secondary"
                                        type="button"
                                        onClick={() => editCustomField(defType, item)}
                                        disabled={!canWrite}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="enterprise-button-danger"
                                        type="button"
                                        onClick={() => void deleteCustomField(defType, item)}
                                        disabled={!canWrite}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="enterprise-button-secondary"
                                      type="button"
                                      onClick={() => void disableSystemDefinition(defType, item)}
                                      disabled={!canWrite || item.isActive === false}
                                    >
                                      Disable
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              <div className="enterprise-inline-actions" style={{ marginTop: 10 }}>
                <button
                  className="enterprise-button-primary"
                  type="button"
                  onClick={() => void saveEnabledDefinitions()}
                  disabled={!canWrite || standardsSaving}
                >
                  Save enabled fields
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="enterprise-empty">Select a company to configure standards and enabled fields.</div>
        )}
      </div>

      {modalOpen ? (
        <Modal title={editing ? "Edit company" : "Create company"} onClose={closeModal}>
          <form className="enterprise-form-grid" onSubmit={(event) => void onSubmit(event)}>
            <label className="enterprise-label" htmlFor="company-name">
              Name
            </label>
            <input
              id="company-name"
              className="enterprise-input"
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="company-legal-name">
              Legal name
            </label>
            <input
              id="company-legal-name"
              className="enterprise-input"
              type="text"
              value={form.legalName}
              onChange={(event) => setForm((current) => ({ ...current, legalName: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="company-country">
              Country
            </label>
            <input
              id="company-country"
              className="enterprise-input"
              type="text"
              value={form.country}
              onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="company-holding">
              Holding
            </label>
            <label className="enterprise-checkbox-row" htmlFor="company-holding">
              <input
                id="company-holding"
                type="checkbox"
                checked={form.isHolding}
                onChange={(event) => setForm((current) => ({ ...current, isHolding: event.target.checked }))}
                disabled={Boolean(editing?.isHolding)}
              />
              <span>
                {editing?.isHolding
                  ? "This company is the tenant holding and cannot be changed"
                  : "Mark as holding company"}
              </span>
            </label>

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save changes" : "Create company"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
