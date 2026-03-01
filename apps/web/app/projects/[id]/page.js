"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const CATEGORY_ORDER = ["E", "S", "G"];

const CATEGORY_LABELS = {
  E: "Environment",
  S: "Social",
  G: "Governance",
};

const SECTION_LABELS = {
  profile: "Profile",
  boundaries: "Boundaries",
  sites: "Sites",
  energy: "Energy",
  fuels: "Fuels",
  refrigerants: "Refrigerants",
  scope1: "Scope 1",
  scope2: "Scope 2",
  scope3: "Scope 3",
  waste: "Waste",
  water: "Water",
  policies: "Policies",
  targets: "Targets",
  health: "Health & Safety",
  diversity: "Diversity",
  training: "Training",
  rights: "Human Rights",
  data_privacy: "Data Privacy",
  suppliers: "Suppliers",
  board: "Board",
  risk: "Risk & Materiality",
  compliance: "Compliance",
  reporting: "Reporting",
  notes: "Notes",
};

const humanize = (value) => {
  if (!value) {
    return "General";
  }
  if (SECTION_LABELS[value]) {
    return SECTION_LABELS[value];
  }
  return value
    .split("_")
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");
};

const isMeaningfulValue = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
};

const normalizeOptions = (options) => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (typeof option === "string") {
        return { value: option, label: option };
      }
      if (option && typeof option === "object" && typeof option.value === "string") {
        return {
          value: option.value,
          label: typeof option.label === "string" ? option.label : option.value,
        };
      }
      return null;
    })
    .filter(Boolean);
};

const formatUpdate = (isoDate) => {
  if (!isoDate) {
    return "";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

function ParameterField({ parameter, value, onChange }) {
  const fieldId = `field-${parameter.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const options = normalizeOptions(parameter.options);

  if (parameter.type === "textarea") {
    return (
      <div className="esg-field">
        <label htmlFor={fieldId}>
          {parameter.label}
          {parameter.required ? <span className="esg-required">required</span> : null}
        </label>
        {parameter.description ? <p className="esg-hint">{parameter.description}</p> : null}
        <textarea
          id={fieldId}
          className="esg-textarea"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(parameter.key, event.target.value || null)}
        />
      </div>
    );
  }

  if (parameter.type === "boolean") {
    const checked = typeof value === "boolean" ? value : false;
    return (
      <div className="esg-field">
        <label htmlFor={fieldId}>
          {parameter.label}
          {parameter.required ? <span className="esg-required">required</span> : null}
        </label>
        {parameter.description ? <p className="esg-hint">{parameter.description}</p> : null}
        <label htmlFor={fieldId} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input
            id={fieldId}
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(parameter.key, event.target.checked)}
          />
          <span>{checked ? "Yes" : "No"}</span>
        </label>
      </div>
    );
  }

  if (parameter.type === "select") {
    return (
      <div className="esg-field">
        <label htmlFor={fieldId}>
          {parameter.label}
          {parameter.required ? <span className="esg-required">required</span> : null}
        </label>
        {parameter.description ? <p className="esg-hint">{parameter.description}</p> : null}
        <select
          id={fieldId}
          className="esg-select"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(parameter.key, event.target.value || null)}
        >
          <option value="">Select...</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (parameter.type === "multiselect") {
    const selectedValues = Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
    return (
      <div className="esg-field">
        <label htmlFor={fieldId}>
          {parameter.label}
          {parameter.required ? <span className="esg-required">required</span> : null}
        </label>
        {parameter.description ? <p className="esg-hint">{parameter.description}</p> : null}
        <select
          id={fieldId}
          className="esg-select"
          multiple
          value={selectedValues}
          onChange={(event) => {
            const next = Array.from(event.target.selectedOptions).map((option) => option.value);
            onChange(parameter.key, next.length > 0 ? next : null);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (parameter.type === "number" || parameter.type === "integer") {
    const numericValue = typeof value === "number" ? String(value) : "";
    return (
      <div className="esg-field">
        <label htmlFor={fieldId}>
          {parameter.label}
          {parameter.required ? <span className="esg-required">required</span> : null}
        </label>
        {parameter.description ? <p className="esg-hint">{parameter.description}</p> : null}
        <input
          id={fieldId}
          className="esg-input"
          type="number"
          step={parameter.type === "integer" ? "1" : "any"}
          value={numericValue}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              onChange(parameter.key, null);
              return;
            }
            const parsed = parameter.type === "integer" ? Number.parseInt(raw, 10) : Number(raw);
            onChange(parameter.key, Number.isFinite(parsed) ? parsed : null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="esg-field">
      <label htmlFor={fieldId}>
        {parameter.label}
        {parameter.required ? <span className="esg-required">required</span> : null}
      </label>
      {parameter.description ? <p className="esg-hint">{parameter.description}</p> : null}
      <input
        id={fieldId}
        className="esg-input"
        type={parameter.type === "date" ? "date" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(parameter.key, event.target.value || null)}
      />
    </div>
  );
}

export default function ProjectWizardPage() {
  const params = useParams();
  const projectId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [project, setProject] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [answerMap, setAnswerMap] = useState({});
  const [activeCategory, setActiveCategory] = useState("E");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queuedPatch, setQueuedPatch] = useState({});
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const loadProject = useCallback(async () => {
    if (!projectId) {
      setError("Missing project id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }

      setProject(payload.project ?? null);
      setParameters(Array.isArray(payload.parameters) ? payload.parameters : []);
      setAnswerMap(payload.answerMap && typeof payload.answerMap === "object" ? payload.answerMap : {});
      setQueuedPatch({});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assessment");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const savePatch = useCallback(
    async (patch) => {
      const entries = Object.entries(patch);
      if (!projectId || entries.length === 0) {
        return;
      }

      setSaveState("saving");
      setSaveError("");

      try {
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/answers`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            answers: entries.map(([parameterKey, value]) => ({ parameterKey, value })),
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }

        setSaveState("saved");
        setSavedAt(new Date().toISOString());
      } catch (savePatchError) {
        setQueuedPatch((current) => ({ ...patch, ...current }));
        setSaveState("error");
        setSaveError(savePatchError instanceof Error ? savePatchError.message : "Autosave failed");
      }
    },
    [projectId],
  );

  useEffect(() => {
    const keys = Object.keys(queuedPatch);
    if (keys.length === 0) {
      return undefined;
    }

    const timer = setTimeout(() => {
      const snapshot = { ...queuedPatch };
      setQueuedPatch((current) => {
        const next = { ...current };
        for (const key of Object.keys(snapshot)) {
          delete next[key];
        }
        return next;
      });
      void savePatch(snapshot);
    }, 900);

    return () => clearTimeout(timer);
  }, [queuedPatch, savePatch]);

  const onAnswerChange = useCallback((parameterKey, value) => {
    setAnswerMap((current) => ({ ...current, [parameterKey]: value }));
    setQueuedPatch((current) => ({ ...current, [parameterKey]: value }));
    setSaveState("queued");
  }, []);

  const categoryGroups = useMemo(() => {
    const grouped = {
      E: [],
      S: [],
      G: [],
    };

    for (const category of CATEGORY_ORDER) {
      const inCategory = parameters.filter((parameter) => parameter.category === category);
      const bySection = new Map();
      for (const parameter of inCategory) {
        const sectionKey = parameter.key.split(".")[1] || "general";
        if (!bySection.has(sectionKey)) {
          bySection.set(sectionKey, []);
        }
        bySection.get(sectionKey).push(parameter);
      }
      grouped[category] = Array.from(bySection.entries()).map(([sectionKey, items]) => ({
        sectionKey,
        sectionLabel: humanize(sectionKey),
        items,
      }));
    }

    return grouped;
  }, [parameters]);

  const requiredParameters = useMemo(() => parameters.filter((parameter) => parameter.required), [parameters]);
  const requiredAnsweredCount = useMemo(
    () => requiredParameters.filter((parameter) => isMeaningfulValue(answerMap[parameter.key])).length,
    [answerMap, requiredParameters],
  );

  const completenessPercent =
    requiredParameters.length === 0 ? 100 : Math.round((requiredAnsweredCount / requiredParameters.length) * 100);

  const categoryStats = useMemo(() => {
    const stats = {};
    for (const category of CATEGORY_ORDER) {
      const categoryParameters = parameters.filter((parameter) => parameter.category === category);
      const categoryRequired = categoryParameters.filter((parameter) => parameter.required);
      const categoryRequiredAnswered = categoryRequired.filter((parameter) =>
        isMeaningfulValue(answerMap[parameter.key]),
      );
      stats[category] = {
        total: categoryParameters.length,
        required: categoryRequired.length,
        requiredAnswered: categoryRequiredAnswered.length,
        completeness:
          categoryRequired.length === 0
            ? 100
            : Math.round((categoryRequiredAnswered.length / categoryRequired.length) * 100),
      };
    }
    return stats;
  }, [answerMap, parameters]);

  const saveStatusText = useMemo(() => {
    if (saveState === "saving") {
      return "Autosave: saving...";
    }
    if (saveState === "error") {
      return `Autosave error: ${saveError}`;
    }
    if (saveState === "saved") {
      const formatted = formatUpdate(savedAt);
      return formatted ? `Autosave: saved ${formatted}` : "Autosave: saved";
    }

    const queuedCount = Object.keys(queuedPatch).length;
    if (queuedCount > 0) {
      return `Autosave: ${queuedCount} change(s) queued`;
    }

    return "Autosave: idle";
  }, [queuedPatch, saveError, saveState, savedAt]);

  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand">{project?.name || "Assessment wizard"}</h1>
            <p className="esg-subtitle">Compila tutti i parametri ESG richiesti e salva in Neon in tempo reale.</p>
          </div>
          <div className="esg-link-row">
            <Link className="esg-link-chip" href="/">
              Back to assessments
            </Link>
            {projectId ? (
              <Link className="esg-link-chip" href={`/projects/${projectId}/report`}>
                Report
              </Link>
            ) : null}
          </div>
        </header>

        {loading ? <section className="esg-card">Loading assessment...</section> : null}
        {!loading && error ? <section className="esg-card esg-status esg-status-error">{error}</section> : null}

        {!loading && !error && !project ? (
          <section className="esg-card esg-empty">Project not found.</section>
        ) : null}

        {!loading && !error && project ? (
          <>
            <section className="esg-card">
              <div className="esg-toolbar">
                <div>
                  <h2 style={{ margin: 0 }}>Completion progress</h2>
                  <p className="esg-subtitle" style={{ marginBottom: 0 }}>
                    Required answered: {requiredAnsweredCount}/{requiredParameters.length}
                  </p>
                </div>
                <div className={saveState === "error" ? "esg-status esg-status-error" : "esg-status"}>{saveStatusText}</div>
              </div>

              <div className="esg-progress-wrap">
                <div className="esg-progress-track" aria-label="Required completion progress">
                  <div className="esg-progress-fill" style={{ width: `${completenessPercent}%` }} />
                </div>
                <p className="esg-status" style={{ marginTop: 8, marginBottom: 0 }}>
                  Completeness: {completenessPercent}%
                </p>
              </div>

              <div className="esg-badge-row" role="tablist" aria-label="Assessment categories">
                {CATEGORY_ORDER.map((category) => {
                  const isActive = category === activeCategory;
                  const stats = categoryStats[category] || { requiredAnswered: 0, required: 0, completeness: 0 };
                  return (
                    <button
                      key={category}
                      type="button"
                      className={isActive ? "esg-badge esg-badge-active" : "esg-badge"}
                      onClick={() => setActiveCategory(category)}
                    >
                      {category} · {CATEGORY_LABELS[category]} · {stats.requiredAnswered}/{stats.required} ({stats.completeness}%)
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="esg-card" style={{ marginTop: 16 }}>
              <h2 style={{ marginTop: 0 }}>
                {activeCategory} · {CATEGORY_LABELS[activeCategory]}
              </h2>

              {categoryGroups[activeCategory]?.length ? (
                <div className="esg-grid">
                  {categoryGroups[activeCategory].map((section) => (
                    <section key={section.sectionKey} className="esg-grid">
                      <h3 style={{ marginBottom: 2 }}>{section.sectionLabel}</h3>
                      <p className="esg-status" style={{ marginTop: 0 }}>
                        {section.items.length} parameter(s)
                      </p>
                      <div className="esg-grid">
                        {section.items.map((parameter) => (
                          <ParameterField
                            key={parameter.key}
                            parameter={parameter}
                            value={answerMap[parameter.key]}
                            onChange={onAnswerChange}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="esg-empty">No parameters configured in this section.</div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
