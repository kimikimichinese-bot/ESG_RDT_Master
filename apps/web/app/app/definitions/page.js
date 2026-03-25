"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTenantSession } from "../_components/use-tenant-session";
import { useCompanyScope } from "../_components/use-company-scope";

const TYPES = [
  { value: "environment", label: "Environment" },
  { value: "ghg", label: "GHG" },
  { value: "social", label: "Social" },
  { value: "governance", label: "Governance" },
];

const DEFAULT_FORM = {
  key: "",
  name: "",
  unit: "",
  category: "Custom",
  description: "",
  scope: "scope3",
  method: "activity",
  scope3Category: "15",
  defaultFactorKey: "",
  fieldType: "text",
  options: "",
};

const toCsvCell = (value) => {
  const raw = value == null ? "" : String(value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '""')}"`;
};

const toApiError = (payload, status) => {
  const code =
    typeof payload?.code === "string" && payload.code.trim() ? payload.code.trim() : `http_${status || 500}`;
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${status || 500}`;
  return `${message} [${code}]`;
};

const normalizeType = (rawType) => {
  const normalized = String(rawType || "").trim().toLowerCase();
  return TYPES.some((item) => item.value === normalized) ? normalized : "ghg";
};

export default function DefinitionManagerPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [type, setType] = useState(() => normalizeType(searchParams.get("type")));
  const [companyId, setCompanyId] = useState("");
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [definitionKindFilter, setDefinitionKindFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [mappingFilter, setMappingFilter] = useState("all");

  const canWrite = useMemo(() => tenant.role === "TenantAdmin" || tenant.role === "Manager", [tenant.role]);
  const filteredDefinitions = useMemo(
    () =>
      definitions.filter((item) => {
        if (definitionKindFilter === "system" && !item.isSystem) {
          return false;
        }
        if (definitionKindFilter === "custom" && item.isSystem) {
          return false;
        }
        if (activityFilter === "active" && item.isActive === false) {
          return false;
        }
        if (activityFilter === "inactive" && item.isActive !== false) {
          return false;
        }
        if (mappingFilter === "mapped" && item?.impact?.mapped !== true) {
          return false;
        }
        if (mappingFilter === "unmapped" && item?.impact?.mapped === true) {
          return false;
        }
        return true;
      }),
    [activityFilter, definitionKindFilter, definitions, mappingFilter],
  );
  const summary = useMemo(
    () => ({
      total: definitions.length,
      custom: definitions.filter((item) => !item.isSystem).length,
      mapped: definitions.filter((item) => item?.impact?.mapped === true).length,
      inactive: definitions.filter((item) => item.isActive === false).length,
    }),
    [definitions],
  );

  useEffect(() => {
    const nextType = normalizeType(searchParams.get("type"));
    setType(nextType);
  }, [searchParams]);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const loadDefinitions = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (companyId) {
        query.set("companyId", companyId);
      }
      if (tenant.platformRole === "superadmin") {
        query.set("includeInactive", "true");
      }
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/definitions/${encodeURIComponent(type)}?${query.toString()}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(toApiError(payload, response.status));
      }
      setDefinitions(Array.isArray(payload.definitions) ? payload.definitions : []);
    } catch (loadError) {
      setDefinitions([]);
      setError(loadError instanceof Error ? loadError.message : "Unable to load definitions");
    } finally {
      setLoading(false);
    }
  }, [companyId, tenant.platformRole, tenant.tenantId, type]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadDefinitions();
    }
  }, [loadDefinitions, tenant.loading, tenant.tenantId]);

  const onTypeChange = (nextType) => {
    const normalized = normalizeType(nextType);
    setType(normalized);
    setEditingKey("");
    setForm(DEFAULT_FORM);
    const params = new URLSearchParams(searchParams.toString());
    params.set("type", normalized);
    router.replace(`/app/definitions?${params.toString()}`);
  };

  const resetForm = () => {
    setEditingKey("");
    setForm(DEFAULT_FORM);
  };

  const exportCatalog = useCallback(() => {
    const headers = [
      "key",
      "name",
      "unit",
      "status",
      "definitionType",
      "recordCount",
      "standardsMappings",
      "topicMappings",
      "companyEnablements",
      "companies",
    ];
    const rows = filteredDefinitions.map((item) => ({
      key: item.key,
      name: item.name || item.label || "",
      unit: item.unit || "",
      status: item.isActive === false ? "inactive" : "active",
      definitionType: item.isSystem ? "system" : "custom",
      recordCount: item?.impact?.recordCount || 0,
      standardsMappings: item?.impact?.standardsMappingCount || 0,
      topicMappings: item?.impact?.topicMappingCount || 0,
      companyEnablements: item?.impact?.companyEnablementCount || 0,
      companies: Array.isArray(item?.impact?.companyEnablements)
        ? item.impact.companyEnablements.map((entry) => entry.companyName).join(" | ")
        : "",
    }));
    const csv = [headers.join(",")]
      .concat(rows.map((row) => headers.map((key) => toCsvCell(row[key])).join(",")))
      .join("\n");
    const blob = new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `definitions-${type}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [filteredDefinitions, type]);

  const buildImpactWarning = useCallback((item, actionLabel) => {
    const impact = item?.impact || {};
    const parts = [];
    if (impact.recordCount) {
      parts.push(`${impact.recordCount} record(s)`);
    }
    if (impact.standardsMappingCount) {
      parts.push(`${impact.standardsMappingCount} standards mapping(s)`);
    }
    if (impact.topicMappingCount) {
      parts.push(`${impact.topicMappingCount} topic mapping(s)`);
    }
    if (impact.companyEnablementCount) {
      parts.push(`${impact.companyEnablementCount} company enablement(s)`);
    }
    if (parts.length === 0) {
      return `${actionLabel} "${item?.key || "definition"}"?`;
    }
    return `${actionLabel} "${item?.key || "definition"}"? Impact: ${parts.join(", ")}.`;
  }, []);

  const startEdit = (item) => {
    setEditingKey(item.key);
    setForm({
      key: item.key || "",
      name: item.name || item.label || "",
      unit: item.unit || "",
      category: item.category || "Custom",
      description: item.description || "",
      scope: item.scope || "scope3",
      method: item.method || "activity",
      scope3Category: item.scope3Category == null ? "15" : String(item.scope3Category),
      defaultFactorKey: item.defaultFactorKey || "",
      fieldType: item.fieldType || "text",
      options: Array.isArray(item.options) ? item.options.join(",") : "",
    });
    setMessage("");
    setError("");
  };

  const submit = useCallback(async () => {
    if (!tenant.tenantId || !canWrite) {
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        key: form.key,
        name: form.name,
        label: form.name,
        unit: form.unit,
      };

      if (type === "environment") {
        payload.category = form.category;
        payload.description = form.description;
      } else if (type === "ghg") {
        payload.scope = form.scope;
        payload.method = form.method;
        payload.scope3Category = Number.parseInt(form.scope3Category || "0", 10);
        payload.defaultFactorKey = form.defaultFactorKey;
      } else if (type === "social") {
        payload.method = form.method;
      } else if (type === "governance") {
        payload.fieldType = form.fieldType;
        payload.options = form.options
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/definitions/${encodeURIComponent(type)}`,
        {
          method: editingKey ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(toApiError(body, response.status));
      }

      setMessage(editingKey ? `Updated ${editingKey}` : `Created ${body?.definition?.key || form.key}`);
      resetForm();
      await loadDefinitions();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save definition");
    } finally {
      setSaving(false);
    }
  }, [canWrite, editingKey, form, loadDefinitions, tenant.tenantId, type]);

  const disableDefinition = useCallback(
    async (itemOrKey) => {
      if (!tenant.tenantId || !canWrite) {
        return;
      }
      const key = typeof itemOrKey === "string" ? itemOrKey : itemOrKey?.key;
      const item = typeof itemOrKey === "string" ? definitions.find((entry) => entry.key === itemOrKey) : itemOrKey;
      const confirmed = window.confirm(buildImpactWarning(item, "Disable"));
      if (!confirmed) {
        return;
      }
      setSaving(true);
      setError("");
      try {
        const response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/definitions/${encodeURIComponent(type)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key, isActive: false }),
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(toApiError(body, response.status));
        }
        setMessage(`Disabled ${key}`);
        await loadDefinitions();
      } catch (disableError) {
        setError(disableError instanceof Error ? disableError.message : "Unable to disable definition");
      } finally {
        setSaving(false);
      }
    },
    [buildImpactWarning, canWrite, definitions, loadDefinitions, tenant.tenantId, type],
  );

  const deleteDefinition = useCallback(
    async (itemOrKey) => {
      if (!tenant.tenantId || !canWrite) {
        return;
      }
      const key = typeof itemOrKey === "string" ? itemOrKey : itemOrKey?.key;
      const item = typeof itemOrKey === "string" ? definitions.find((entry) => entry.key === itemOrKey) : itemOrKey;
      const confirmed = window.confirm(buildImpactWarning(item, "Delete"));
      if (!confirmed) {
        return;
      }
      setSaving(true);
      setError("");
      try {
        const response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/definitions/${encodeURIComponent(type)}?key=${encodeURIComponent(key)}`,
          { method: "DELETE" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(toApiError(body, response.status));
        }
        setMessage(`Deleted ${key}`);
        if (editingKey === key) {
          resetForm();
        }
        await loadDefinitions();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Unable to delete definition");
      } finally {
        setSaving(false);
      }
    },
    [buildImpactWarning, canWrite, definitions, editingKey, loadDefinitions, tenant.tenantId, type],
  );

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Definition Manager</h2>
          <p className="enterprise-muted">Full CRUD for custom fields. System definitions can be disabled but not deleted.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadDefinitions()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-kpi-grid" style={{ marginBottom: 12 }}>
          <article className="enterprise-kpi-card">
            <strong>Total</strong>
            <p>{summary.total}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Custom</strong>
            <p>{summary.custom}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Mapped</strong>
            <p>{summary.mapped}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Inactive</strong>
            <p>{summary.inactive}</p>
          </article>
        </div>
        <div className="enterprise-inline-actions" style={{ flexWrap: "wrap" }}>
          {TYPES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={type === item.value ? "enterprise-button-primary" : "enterprise-button-secondary"}
              onClick={() => onTypeChange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="enterprise-filter-grid" style={{ marginTop: 10 }}>
          <label className="enterprise-label" htmlFor="definitions-company">Company filter</label>
          <select
            id="definitions-company"
            className="enterprise-input"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          >
            <option value="">All enabled/default</option>
            {companyScope.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <label className="enterprise-label" htmlFor="definitions-kind">Definition type</label>
          <select
            id="definitions-kind"
            className="enterprise-input"
            value={definitionKindFilter}
            onChange={(event) => setDefinitionKindFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="system">System</option>
            <option value="custom">Custom</option>
          </select>
          <label className="enterprise-label" htmlFor="definitions-status">Status</label>
          <select
            id="definitions-status"
            className="enterprise-input"
            value={activityFilter}
            onChange={(event) => setActivityFilter(event.target.value)}
          >
            <option value="all">Active + inactive</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <label className="enterprise-label" htmlFor="definitions-mapping">Mapping</label>
          <select
            id="definitions-mapping"
            className="enterprise-input"
            value={mappingFilter}
            onChange={(event) => setMappingFilter(event.target.value)}
          >
            <option value="all">Mapped + unmapped</option>
            <option value="mapped">Mapped</option>
            <option value="unmapped">Unmapped</option>
          </select>
        </div>
        <div className="enterprise-inline-actions" style={{ marginTop: 10 }}>
          <button className="enterprise-button-secondary" type="button" onClick={exportCatalog} disabled={filteredDefinitions.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status enterprise-status-ok">{message}</p> : null}

      <div className="enterprise-card">
        <h3 style={{ marginTop: 0 }}>{editingKey ? `Edit ${editingKey}` : "Create custom field"}</h3>
        <div className="enterprise-form-grid">
          <label className="enterprise-label" htmlFor="def-key">Key</label>
          <input
            id="def-key"
            className="enterprise-input"
            value={form.key}
            onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
            disabled={!canWrite || Boolean(editingKey)}
          />

          <label className="enterprise-label" htmlFor="def-name">Name</label>
          <input
            id="def-name"
            className="enterprise-input"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            disabled={!canWrite}
          />

          <label className="enterprise-label" htmlFor="def-unit">Unit</label>
          <input
            id="def-unit"
            className="enterprise-input"
            value={form.unit}
            onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
            disabled={!canWrite}
          />

          {type === "environment" ? (
            <>
              <label className="enterprise-label" htmlFor="def-category">Category</label>
              <input
                id="def-category"
                className="enterprise-input"
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                disabled={!canWrite}
              />

              <label className="enterprise-label" htmlFor="def-description">Description</label>
              <input
                id="def-description"
                className="enterprise-input"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                disabled={!canWrite}
              />
            </>
          ) : null}

          {type === "ghg" ? (
            <>
              <label className="enterprise-label" htmlFor="def-scope">Scope</label>
              <select
                id="def-scope"
                className="enterprise-input"
                value={form.scope}
                onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))}
                disabled={!canWrite}
              >
                <option value="scope1">Scope 1</option>
                <option value="scope2">Scope 2</option>
                <option value="scope3">Scope 3</option>
              </select>

              <label className="enterprise-label" htmlFor="def-method">Method</label>
              <select
                id="def-method"
                className="enterprise-input"
                value={form.method}
                onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}
                disabled={!canWrite}
              >
                <option value="activity">activity</option>
                <option value="spend">spend</option>
                <option value="supplier_specific">supplier_specific</option>
                <option value="direct_tco2e">direct_tco2e</option>
              </select>

              {form.scope === "scope3" ? (
                <>
                  <label className="enterprise-label" htmlFor="def-scope3-category">Scope 3 category</label>
                  <input
                    id="def-scope3-category"
                    className="enterprise-input"
                    type="number"
                    min="1"
                    max="15"
                    value={form.scope3Category}
                    onChange={(event) => setForm((current) => ({ ...current, scope3Category: event.target.value }))}
                    disabled={!canWrite}
                  />
                </>
              ) : null}

              <label className="enterprise-label" htmlFor="def-factor-key">Default factor key</label>
              <input
                id="def-factor-key"
                className="enterprise-input"
                value={form.defaultFactorKey}
                onChange={(event) => setForm((current) => ({ ...current, defaultFactorKey: event.target.value }))}
                disabled={!canWrite}
              />
            </>
          ) : null}

          {type === "social" ? (
            <>
              <label className="enterprise-label" htmlFor="def-social-method">Method</label>
              <select
                id="def-social-method"
                className="enterprise-input"
                value={form.method}
                onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}
                disabled={!canWrite}
              >
                <option value="manual">manual</option>
                <option value="computed">computed</option>
              </select>
            </>
          ) : null}

          {type === "governance" ? (
            <>
              <label className="enterprise-label" htmlFor="def-field-type">Field type</label>
              <select
                id="def-field-type"
                className="enterprise-input"
                value={form.fieldType}
                onChange={(event) => setForm((current) => ({ ...current, fieldType: event.target.value }))}
                disabled={!canWrite}
              >
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="select">select</option>
              </select>

              <label className="enterprise-label" htmlFor="def-options">Options (comma separated)</label>
              <input
                id="def-options"
                className="enterprise-input"
                value={form.options}
                onChange={(event) => setForm((current) => ({ ...current, options: event.target.value }))}
                disabled={!canWrite}
              />
            </>
          ) : null}
        </div>

        <div className="enterprise-inline-actions" style={{ marginTop: 10 }}>
          <button className="enterprise-button-primary" type="button" onClick={() => void submit()} disabled={!canWrite || saving}>
            {saving ? "Saving..." : editingKey ? "Save changes" : "Create"}
          </button>
          {editingKey ? (
            <button className="enterprise-button-secondary" type="button" onClick={resetForm} disabled={saving}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="enterprise-card">
        <h3 style={{ marginTop: 0 }}>Definitions</h3>
        {loading ? <p className="enterprise-status">Loading...</p> : null}
        {!loading && filteredDefinitions.length === 0 ? <div className="enterprise-empty">No definitions found.</div> : null}
        {!loading && filteredDefinitions.length > 0 ? (
          <div className="enterprise-table-wrap">
            <table className="enterprise-table enterprise-table-wide">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Impact</th>
                  <th>Enabled in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDefinitions.map((item) => (
                  <tr key={item.key}>
                    <td>{item.key}</td>
                    <td>{item.name || item.label || "-"}</td>
                    <td>{item.unit || "-"}</td>
                    <td>{item.isActive === false ? "Inactive" : "Active"}</td>
                    <td>{item.isSystem ? "System" : "Custom"}</td>
                    <td>
                      <div>{item?.impact?.recordCount || 0} record(s)</div>
                      <div>{item?.impact?.standardsMappingCount || 0} standards mapping(s)</div>
                      <div>{item?.impact?.topicMappingCount || 0} topic mapping(s)</div>
                    </td>
                    <td>
                      {Array.isArray(item?.impact?.companyEnablements) && item.impact.companyEnablements.length > 0 ? (
                        item.impact.companyEnablements.map((entry) => (
                          <div key={`${item.key}:${entry.companyId}`}>
                            {entry.companyName}
                            {entry.required ? " · required" : ""}
                          </div>
                        ))
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <div className="enterprise-inline-actions">
                        <button
                          className="enterprise-button-secondary"
                          type="button"
                          onClick={() => startEdit(item)}
                          disabled={!canWrite}
                        >
                          Edit
                        </button>
                        {item.isSystem ? (
                          <button
                            className="enterprise-button-secondary"
                            type="button"
                            onClick={() => void disableDefinition(item)}
                            disabled={!canWrite || item.isActive === false}
                          >
                            Disable
                          </button>
                        ) : (
                          <button
                            className="enterprise-button-danger"
                            type="button"
                            onClick={() => void deleteDefinition(item)}
                            disabled={!canWrite}
                          >
                            Delete
                          </button>
                        )}
                      </div>
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
