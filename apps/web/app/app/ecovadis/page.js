"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

const currentYear = new Date().getFullYear();
const SCOPE_TYPES = ["Group", "Entity", "Site"];

const emptyCreateForm = {
  companyId: "",
  reportingYear: String(currentYear),
  scopeType: "Group",
};

const emptyUploadForm = {
  issueDate: "",
  docType: "other",
  scopeCoverage: "tenant",
  isEncrypted: false,
  language: "en",
};

const defaultAttachmentDraft = {
  evidenceId: "",
  pages: "",
  comment: "",
  visibility: "private",
};

const extractError = (payload, fallback) => {
  if (payload && typeof payload === "object") {
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }
  return fallback;
};

const makeThemeBuckets = (questions) => {
  const map = new Map();
  for (const question of questions || []) {
    const theme = question.theme || "General";
    if (!map.has(theme)) {
      map.set(theme, []);
    }
    map.get(theme).push(question);
  }
  return [...map.entries()].map(([theme, items]) => ({
    theme,
    questions: items,
  }));
};

export default function EcoVadisPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [assessments, setAssessments] = useState([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState("");
  const [detail, setDetail] = useState(null);
  const [draftAnswers, setDraftAnswers] = useState({});
  const [attachmentDrafts, setAttachmentDrafts] = useState({});
  const [evidenceItems, setEvidenceItems] = useState([]);
  const [uploadForm, setUploadForm] = useState(emptyUploadForm);
  const [uploadFile, setUploadFile] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [busyImport, setBusyImport] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setCreateForm((current) => ({ ...current, companyId: companyScope.activeCompanyId }));
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  const evidenceMap = useMemo(() => {
    const map = new Map();
    for (const item of evidenceItems) {
      map.set(item.id, item);
    }
    return map;
  }, [evidenceItems]);

  const themeBuckets = useMemo(() => makeThemeBuckets(detail?.questions || []), [detail]);

  const initializeDraftFromDetail = useCallback((nextDetail) => {
    const nextDraft = {};
    const nextAttachmentDrafts = {};

    for (const question of nextDetail?.questions || []) {
      for (const option of question.options || []) {
        nextDraft[option.id] = {
          selected: Boolean(option.answer?.selected),
          freeText: option.answer?.freeText || "",
        };

        if (option.answer?.id) {
          nextAttachmentDrafts[option.answer.id] = {
            ...defaultAttachmentDraft,
          };
        }
      }
    }

    setDraftAnswers(nextDraft);
    setAttachmentDrafts(nextAttachmentDrafts);
  }, []);

  const loadEvidence = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }

    setEvidenceItems(Array.isArray(payload.evidence) ? payload.evidence : []);
  }, [tenant.tenantId]);

  const loadAssessments = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }

    const nextAssessments = Array.isArray(payload.assessments) ? payload.assessments : [];
    setAssessments(nextAssessments);

    if (nextAssessments.length > 0) {
      if (selectedAssessmentId && nextAssessments.some((item) => item.id === selectedAssessmentId)) {
        return;
      }
      setSelectedAssessmentId(nextAssessments[0].id);
    } else {
      setSelectedAssessmentId("");
      setDetail(null);
      setDraftAnswers({});
      setAttachmentDrafts({});
    }
  }, [selectedAssessmentId, tenant.tenantId]);

  const loadDetail = useCallback(
    async (assessmentId) => {
      if (!tenant.tenantId || !assessmentId) {
        return;
      }

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(assessmentId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setDetail(payload);
      initializeDraftFromDetail(payload);
    },
    [initializeDraftFromDetail, tenant.tenantId],
  );

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      setLoading(true);
      setError("");
      setMessage("");
      Promise.all([loadAssessments(), loadEvidence()])
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Unable to load EcoVadis data");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [tenant.loading, tenant.tenantId, loadAssessments, loadEvidence]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && selectedAssessmentId) {
      setLoading(true);
      setError("");
      loadDetail(selectedAssessmentId)
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Unable to load assessment detail");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [tenant.loading, tenant.tenantId, selectedAssessmentId, loadDetail]);

  const createAssessment = async () => {
    if (!tenant.tenantId || !canWrite) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          companyId: createForm.companyId,
          reportingYear: Number.parseInt(createForm.reportingYear, 10),
          scopeType: createForm.scopeType,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage("Assessment created/selected.");
      await loadAssessments();
      if (payload.assessment?.id) {
        setSelectedAssessmentId(payload.assessment.id);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create assessment");
    }
  };

  const runImport = async ({ useUpload }) => {
    if (!tenant.tenantId || !selectedAssessmentId || !canWrite) {
      return;
    }

    setBusyImport(true);
    setError("");
    setMessage("");

    try {
      let response;
      if (useUpload) {
        if (!importFile) {
          throw new Error("Select a DOCX file first.");
        }

        const formData = new FormData();
        formData.append("file", importFile);

        response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(selectedAssessmentId)}/import`,
          {
            method: "POST",
            body: formData,
          },
        );
      } else {
        response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(selectedAssessmentId)}/import`,
          {
            method: "POST",
          },
        );
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage(`Questionnaire imported (${payload.importedQuestions} questions).`);
      await loadDetail(selectedAssessmentId);
      await loadAssessments();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import questionnaire");
    } finally {
      setBusyImport(false);
    }
  };

  const updateDraftAnswer = (optionId, patch) => {
    setDraftAnswers((current) => ({
      ...current,
      [optionId]: {
        selected: Boolean(current[optionId]?.selected),
        freeText: current[optionId]?.freeText || "",
        ...patch,
      },
    }));
  };

  const saveAnswers = async () => {
    if (!tenant.tenantId || !selectedAssessmentId || !canWrite) {
      return;
    }

    setSavingAnswers(true);
    setError("");
    setMessage("");

    try {
      const rows = Object.entries(draftAnswers).map(([optionId, value]) => ({
        optionId,
        selected: value.selected === true,
        freeText: value.freeText || "",
      }));

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(selectedAssessmentId)}/answers`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ rows }),
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage("Answers saved.");
      await loadDetail(selectedAssessmentId);
      await loadAssessments();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save answers");
    } finally {
      setSavingAnswers(false);
    }
  };

  const updateAttachmentDraft = (answerId, patch) => {
    setAttachmentDrafts((current) => ({
      ...current,
      [answerId]: {
        ...defaultAttachmentDraft,
        ...(current[answerId] || {}),
        ...patch,
      },
    }));
  };

  const attachEvidence = async (answerId, existingRows) => {
    if (!tenant.tenantId || !selectedAssessmentId || !canWrite) {
      return;
    }

    const draft = attachmentDrafts[answerId] || defaultAttachmentDraft;
    if (!draft.evidenceId) {
      setError("Select an evidence record before attaching.");
      return;
    }
    if (!draft.pages) {
      setError("Pages are required for evidence attachment.");
      return;
    }

    setError("");
    setMessage("");

    try {
      const rows = [...(existingRows || []).map((row) => ({
        evidenceId: row.evidenceId,
        pages: row.pages,
        comment: row.comment || "",
        visibility: row.visibility || "private",
      }))];

      const deduped = new Map(rows.map((row) => [row.evidenceId, row]));
      deduped.set(draft.evidenceId, {
        evidenceId: draft.evidenceId,
        pages: draft.pages,
        comment: draft.comment || "",
        visibility: draft.visibility || "private",
      });

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(selectedAssessmentId)}/answers/${encodeURIComponent(answerId)}/evidence`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ rows: [...deduped.values()] }),
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage("Evidence attached to answer.");
      updateAttachmentDraft(answerId, defaultAttachmentDraft);
      await loadDetail(selectedAssessmentId);
      await loadAssessments();
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : "Unable to attach evidence");
    }
  };

  const removeAttachedEvidence = async (answerId, existingRows, evidenceIdToRemove) => {
    if (!tenant.tenantId || !selectedAssessmentId || !canWrite) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const rows = (existingRows || [])
        .filter((row) => row.evidenceId !== evidenceIdToRemove)
        .map((row) => ({
          evidenceId: row.evidenceId,
          pages: row.pages,
          comment: row.comment || "",
          visibility: row.visibility || "private",
        }));

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(selectedAssessmentId)}/answers/${encodeURIComponent(answerId)}/evidence`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ rows }),
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage("Evidence removed.");
      await loadDetail(selectedAssessmentId);
      await loadAssessments();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove evidence");
    }
  };

  const runCheckSubmit = async ({ submit }) => {
    if (!tenant.tenantId || !selectedAssessmentId) {
      return;
    }

    setChecking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(selectedAssessmentId)}/check-submit`,
        {
          method: submit ? "POST" : "GET",
          headers: submit
            ? {
                "content-type": "application/json",
              }
            : undefined,
          body: submit ? JSON.stringify({ submit: true }) : undefined,
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage(submit ? "Assessment submitted." : "Check completed.");
      await loadDetail(selectedAssessmentId);
      await loadAssessments();
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Unable to run Check & Submit");
    } finally {
      setChecking(false);
    }
  };

  const uploadEvidence = async () => {
    if (!tenant.tenantId || !canWrite) {
      return;
    }

    if (!uploadFile) {
      setError("Select a file before uploading evidence.");
      return;
    }

    setBusyUpload(true);
    setError("");
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      if (uploadForm.issueDate) {
        formData.append("issueDate", uploadForm.issueDate);
      }
      if (uploadForm.docType) {
        formData.append("docType", uploadForm.docType);
      }
      if (uploadForm.scopeCoverage) {
        formData.append("scopeCoverage", uploadForm.scopeCoverage);
      }
      formData.append("isEncrypted", uploadForm.isEncrypted ? "true" : "false");
      if (uploadForm.language) {
        formData.append("language", uploadForm.language);
      }

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/upload`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setUploadFile(null);
      setUploadForm(emptyUploadForm);
      setMessage("Evidence uploaded to vault.");
      await loadEvidence();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload evidence");
    } finally {
      setBusyUpload(false);
    }
  };

  const downloadExport = async (format) => {
    if (!tenant.tenantId || !selectedAssessmentId) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/ecovadis/assessments/${encodeURIComponent(selectedAssessmentId)}/export?format=${encodeURIComponent(format)}`,
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        format === "docx"
          ? `ecovadis-summary-${selectedAssessmentId}.docx`
          : `ecovadis-summary-${selectedAssessmentId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setMessage(`Exported ${format.toUpperCase()} summary.`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to export summary");
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">EcoVadis Questionnaire</h2>
          <p className="enterprise-muted">
            End-to-end questionnaire workflow with evidence attachments, scope checks, Check &amp; Submit and anonymized
            DOCX export.
          </p>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status">{message}</p> : null}
      {loading ? <p className="enterprise-status">Loading EcoVadis module...</p> : null}

      <div className="enterprise-card-grid">
        <div className="enterprise-card">
          <h3>Create or Select Assessment</h3>
          <div className="enterprise-grid enterprise-grid-compact">
            <label className="enterprise-label" htmlFor="eco-company">
              Company
            </label>
            <select
              id="eco-company"
              className="enterprise-input"
              value={createForm.companyId}
              onChange={(event) => setCreateForm((current) => ({ ...current, companyId: event.target.value }))}
              disabled={!canWrite}
            >
              <option value="">Select company</option>
              {companyScope.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>

            <label className="enterprise-label" htmlFor="eco-year">
              Reporting year
            </label>
            <input
              id="eco-year"
              className="enterprise-input"
              type="number"
              value={createForm.reportingYear}
              onChange={(event) => setCreateForm((current) => ({ ...current, reportingYear: event.target.value }))}
              disabled={!canWrite}
            />

            <label className="enterprise-label" htmlFor="eco-scope">
              Scope type
            </label>
            <select
              id="eco-scope"
              className="enterprise-input"
              value={createForm.scopeType}
              onChange={(event) => setCreateForm((current) => ({ ...current, scopeType: event.target.value }))}
              disabled={!canWrite}
            >
              {SCOPE_TYPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </select>

            {canWrite ? (
              <button className="enterprise-button-primary" type="button" onClick={() => void createAssessment()}>
                Create / Load
              </button>
            ) : null}
          </div>

          <label className="enterprise-label" htmlFor="eco-assessment">
            Assessment
          </label>
          <select
            id="eco-assessment"
            className="enterprise-input"
            value={selectedAssessmentId}
            onChange={(event) => setSelectedAssessmentId(event.target.value)}
          >
            <option value="">Select assessment</option>
            {assessments.map((assessment) => (
              <option key={assessment.id} value={assessment.id}>
                {assessment.reportingYear} - {assessment.scopeType} - {assessment.status}
              </option>
            ))}
          </select>
        </div>

        <div className="enterprise-card">
          <h3>Questionnaire Import</h3>
          <p className="enterprise-muted">
            Import from repository file `print-filled-questionnaire.docx` (if present) or upload a DOCX.
          </p>
          <input
            className="enterprise-input"
            type="file"
            accept=".docx"
            onChange={(event) => setImportFile(event.target.files?.[0] || null)}
            disabled={!selectedAssessmentId || !canWrite || busyImport}
          />
          <div className="enterprise-inline-actions">
            <button
              className="enterprise-button-secondary"
              type="button"
              onClick={() => void runImport({ useUpload: true })}
              disabled={!selectedAssessmentId || !canWrite || busyImport}
            >
              {busyImport ? "Importing..." : "Import uploaded DOCX"}
            </button>
            <button
              className="enterprise-button-secondary"
              type="button"
              onClick={() => void runImport({ useUpload: false })}
              disabled={!selectedAssessmentId || !canWrite || busyImport}
            >
              {busyImport ? "Importing..." : "Import repo questionnaire"}
            </button>
          </div>
        </div>
      </div>

      <div className="enterprise-card">
        <h3>Upload New Evidence</h3>
        <p className="enterprise-muted">Add evidence directly to the Evidence Vault and then attach it to selected answers.</p>
        <div className="enterprise-grid enterprise-grid-compact">
          <input
            className="enterprise-input"
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png"
            onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
            disabled={!canWrite || busyUpload}
          />

          <label className="enterprise-label" htmlFor="eco-evidence-date">
            Issue date
          </label>
          <input
            id="eco-evidence-date"
            className="enterprise-input"
            type="date"
            value={uploadForm.issueDate}
            onChange={(event) => setUploadForm((current) => ({ ...current, issueDate: event.target.value }))}
            disabled={!canWrite || busyUpload}
          />

          <label className="enterprise-label" htmlFor="eco-evidence-doc-type">
            Doc type
          </label>
          <select
            id="eco-evidence-doc-type"
            className="enterprise-input"
            value={uploadForm.docType}
            onChange={(event) => setUploadForm((current) => ({ ...current, docType: event.target.value }))}
            disabled={!canWrite || busyUpload}
          >
            <option value="policy">Policy</option>
            <option value="action">Action</option>
            <option value="reporting">Reporting</option>
            <option value="audit">Audit</option>
            <option value="certification">Certification</option>
            <option value="other">Other</option>
          </select>

          <label className="enterprise-label" htmlFor="eco-evidence-coverage">
            Scope coverage
          </label>
          <select
            id="eco-evidence-coverage"
            className="enterprise-input"
            value={uploadForm.scopeCoverage}
            onChange={(event) => setUploadForm((current) => ({ ...current, scopeCoverage: event.target.value }))}
            disabled={!canWrite || busyUpload}
          >
            <option value="tenant">Tenant</option>
            <option value="company">Company</option>
            <option value="site">Site</option>
          </select>

          <label className="enterprise-label" htmlFor="eco-evidence-language">
            Language
          </label>
          <input
            id="eco-evidence-language"
            className="enterprise-input"
            value={uploadForm.language}
            onChange={(event) => setUploadForm((current) => ({ ...current, language: event.target.value }))}
            disabled={!canWrite || busyUpload}
          />

          <label className="enterprise-checkbox-row">
            <input
              type="checkbox"
              checked={uploadForm.isEncrypted}
              onChange={(event) => setUploadForm((current) => ({ ...current, isEncrypted: event.target.checked }))}
              disabled={!canWrite || busyUpload}
            />
            Mark as encrypted
          </label>

          <button
            className="enterprise-button-secondary"
            type="button"
            onClick={() => void uploadEvidence()}
            disabled={!canWrite || busyUpload}
          >
            {busyUpload ? "Uploading..." : "Upload evidence"}
          </button>
        </div>
      </div>

      {detail ? (
        <div className="enterprise-card">
          <div className="enterprise-toolbar">
            <div>
              <h3>Questionnaire</h3>
              <p className="enterprise-muted">
                Assessment {detail.assessment.reportingYear} · {detail.assessment.scopeType} · Status: {detail.assessment.status}
              </p>
            </div>
            <div className="enterprise-inline-actions">
              {canWrite ? (
                <button
                  className="enterprise-button-primary"
                  type="button"
                  onClick={() => void saveAnswers()}
                  disabled={savingAnswers}
                >
                  {savingAnswers ? "Saving..." : "Save answers"}
                </button>
              ) : null}
            </div>
          </div>

          {themeBuckets.map((bucket) => (
            <div key={bucket.theme} className="enterprise-stack">
              <h4>{bucket.theme}</h4>
              {bucket.questions.map((question) => (
                <div key={question.id} className="enterprise-subcard">
                  <p>
                    <strong>
                      {question.code} {question.required ? "(Mandatory)" : "(Optional)"}
                    </strong>
                  </p>
                  <p>{question.text}</p>

                  <div className="enterprise-table-wrap">
                    <table className="enterprise-table">
                      <thead>
                        <tr>
                          <th>Selected</th>
                          <th>Option</th>
                          <th>Free text</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {question.options.map((option) => {
                          const draft = draftAnswers[option.id] || { selected: false, freeText: "" };
                          const evidenceRows = option.evidence || [];
                          const answerId = option.answer?.id || "";
                          const attachmentDraft = attachmentDrafts[answerId] || defaultAttachmentDraft;

                          return (
                            <tr key={option.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={draft.selected}
                                  onChange={(event) => updateDraftAnswer(option.id, { selected: event.target.checked })}
                                  disabled={!canWrite}
                                />
                              </td>
                              <td>{option.label}</td>
                              <td>
                                {option.hasFreeText ? (
                                  <textarea
                                    className="enterprise-input"
                                    value={draft.freeText}
                                    onChange={(event) => updateDraftAnswer(option.id, { freeText: event.target.value })}
                                    disabled={!canWrite}
                                  />
                                ) : (
                                  "-"
                                )}
                              </td>
                              <td>
                                {!draft.selected || !option.requiresEvidence ? (
                                  <span>-</span>
                                ) : (
                                  <div className="enterprise-stack">
                                    {answerId ? (
                                      <>
                                        {evidenceRows.length === 0 ? <p className="enterprise-muted">No evidence attached.</p> : null}
                                        {evidenceRows.map((row) => {
                                          const evidence = evidenceMap.get(row.evidenceId);
                                          return (
                                            <div key={row.evidenceId} className="enterprise-inline-actions">
                                              <span>
                                                {evidence?.filename || row.evidenceId} · pages {row.pages} · {row.visibility}
                                              </span>
                                              {canWrite ? (
                                                <button
                                                  className="enterprise-button-link"
                                                  type="button"
                                                  onClick={() =>
                                                    void removeAttachedEvidence(answerId, evidenceRows, row.evidenceId)
                                                  }
                                                >
                                                  Remove
                                                </button>
                                              ) : null}
                                            </div>
                                          );
                                        })}

                                        {canWrite ? (
                                          <div className="enterprise-grid enterprise-grid-compact">
                                            <select
                                              className="enterprise-input"
                                              value={attachmentDraft.evidenceId}
                                              onChange={(event) =>
                                                updateAttachmentDraft(answerId, { evidenceId: event.target.value })
                                              }
                                            >
                                              <option value="">Select evidence</option>
                                              {evidenceItems.map((item) => (
                                                <option key={item.id} value={item.id}>
                                                  {item.filename}
                                                </option>
                                              ))}
                                            </select>
                                            <input
                                              className="enterprise-input"
                                              placeholder="Pages (e.g. 2-4,7)"
                                              value={attachmentDraft.pages}
                                              onChange={(event) =>
                                                updateAttachmentDraft(answerId, { pages: event.target.value })
                                              }
                                            />
                                            <input
                                              className="enterprise-input"
                                              placeholder="Comment"
                                              value={attachmentDraft.comment}
                                              onChange={(event) =>
                                                updateAttachmentDraft(answerId, { comment: event.target.value })
                                              }
                                            />
                                            <select
                                              className="enterprise-input"
                                              value={attachmentDraft.visibility}
                                              onChange={(event) =>
                                                updateAttachmentDraft(answerId, { visibility: event.target.value })
                                              }
                                            >
                                              <option value="private">Private</option>
                                              <option value="public">Public</option>
                                            </select>
                                            <button
                                              className="enterprise-button-secondary"
                                              type="button"
                                              onClick={() => void attachEvidence(answerId, evidenceRows)}
                                            >
                                              Attach / Replace
                                            </button>
                                          </div>
                                        ) : null}
                                      </>
                                    ) : (
                                      <p className="enterprise-muted">Save answers before attaching evidence.</p>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {detail ? (
        <div className="enterprise-card-grid">
          <div className="enterprise-card">
            <h3>Check &amp; Submit</h3>
            <div className="enterprise-inline-actions">
              <button
                className="enterprise-button-secondary"
                type="button"
                onClick={() => void runCheckSubmit({ submit: false })}
                disabled={checking}
              >
                {checking ? "Checking..." : "Run check"}
              </button>
              {canWrite ? (
                <button
                  className="enterprise-button-primary"
                  type="button"
                  onClick={() => void runCheckSubmit({ submit: true })}
                  disabled={checking}
                >
                  {checking ? "Submitting..." : "Submit"}
                </button>
              ) : null}
            </div>

            {detail.check ? (
              <div className="enterprise-stack">
                <p>
                  Blockers: <strong>{detail.check.blockerCount}</strong> · Can submit: {detail.check.canSubmit ? "Yes" : "No"}
                </p>
                <p>
                  Distinct evidence: {detail.check.documentCap.distinctEvidenceCount}/{detail.check.documentCap.limit}
                </p>
                {detail.check.documentCap.overflow > 0 ? (
                  <p className="enterprise-status enterprise-status-error">
                    Evidence cap exceeded by {detail.check.documentCap.overflow} document(s).
                  </p>
                ) : null}

                <div>
                  <strong>Missing mandatory answers</strong>
                  <ul>
                    {detail.check.missingMandatoryAnswers.map((item) => (
                      <li key={item.questionId}>
                        {item.questionCode}: {item.questionText}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <strong>Selected options missing evidence</strong>
                  <ul>
                    {detail.check.selectedMissingEvidence.map((item) => (
                      <li key={item.answerId}>
                        {item.questionCode} - {item.optionLabel}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <strong>Evidence missing pages</strong>
                  <ul>
                    {detail.check.selectedMissingPages.map((item) => (
                      <li key={`${item.answerId}:${item.evidenceId}`}>
                        {item.questionCode} - {item.optionLabel} (evidence {item.evidenceId})
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <strong>Out-of-scope evidence</strong>
                  <ul>
                    {detail.check.outOfScopeEvidence.map((item) => (
                      <li key={item.evidenceId}>
                        {item.filename} ({item.evidenceId})
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <strong>Invalid metadata</strong>
                  <ul>
                    {detail.check.invalidMetadata.map((item) => (
                      <li key={`${item.evidenceId}:${item.reason}`}>
                        {item.filename || item.evidenceId}: {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <strong>Metadata warnings</strong>
                  <ul>
                    {detail.check.metadataWarnings.map((item) => (
                      <li key={`${item.evidenceId}:${item.reason}`}>
                        {item.filename || item.evidenceId}: {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>

          <div className="enterprise-card">
            <h3>Export</h3>
            <p className="enterprise-muted">Download questionnaire summary as JSON or anonymized DOCX.</p>
            <div className="enterprise-inline-actions">
              <button className="enterprise-button-secondary" type="button" onClick={() => void downloadExport("json")}>
                Download JSON
              </button>
              <button className="enterprise-button-secondary" type="button" onClick={() => void downloadExport("docx")}>
                Download DOCX
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
