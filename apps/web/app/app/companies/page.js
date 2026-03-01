"use client";

import { useCallback, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useTenantSession } from "../_components/use-tenant-session";
import { useCompanyScope } from "../_components/use-company-scope";

const emptyForm = {
  name: "",
  legalName: "",
  country: "",
  isHolding: false,
};

export default function CompaniesPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const canWrite = useMemo(
    () => tenant.role === "TenantAdmin" || tenant.role === "Manager",
    [tenant.role],
  );

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
                  <td>{company.isHolding ? <span className="enterprise-pill">Holding</span> : "Operating"}</td>
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
