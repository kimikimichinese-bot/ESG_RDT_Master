"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const parseResponse = async (response) => {
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_error) {
      json = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, json };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const terminalStates = new Set(["succeeded", "failed"]);

const getFirstJob = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (Array.isArray(payload.jobs) && payload.jobs.length > 0) {
    return payload.jobs[0];
  }
  if (typeof payload.id === "string") {
    return payload;
  }
  return null;
};

function UrlAnalyzerClient() {
  const searchParams = useSearchParams();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState(null);
  const [rawJson, setRawJson] = useState(null);
  const autoRunKeysRef = useRef(new Set());

  const prefillUrl = useMemo(() => searchParams.get("url")?.trim() ?? "", [searchParams]);
  const shouldAutorun = useMemo(() => searchParams.get("autorun") === "1", [searchParams]);

  const output = useMemo(() => (job && job.result && typeof job.result === "object" ? job.result : null), [job]);

  const pollJob = useCallback(async (jobId) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await sleep(2000);
      const detailResponse = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const detail = await parseResponse(detailResponse);
      if (!detail.ok) {
        throw new Error(`Polling failed with HTTP ${detail.status}`);
      }
      const nextJob = getFirstJob(detail.json);
      if (!nextJob) {
        throw new Error("Polling payload missing job data");
      }
      setJob(nextJob);
      setRawJson(detail.json);
      if (terminalStates.has(nextJob.status)) {
        return nextJob;
      }
    }
    throw new Error("Polling timeout reached");
  }, []);

  const runAnalyze = useCallback(
    async (inputUrl) => {
      setBusy(true);
      setError("");

      try {
        const targetUrl = inputUrl.trim();
        if (!targetUrl) {
          throw new Error("URL is required");
        }

        const triggerResponse = await fetch("/api/v1/jobs/trigger", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jobType: "analyze_url",
            payload: { url: targetUrl },
          }),
          cache: "no-store",
        });

        const trigger = await parseResponse(triggerResponse);
        if (!trigger.ok) {
          throw new Error(
            trigger.json?.error
              ? `Trigger error: ${trigger.json.error}`
              : `Trigger failed with HTTP ${trigger.status}`,
          );
        }

        const createdJob = getFirstJob(trigger.json);
        if (!createdJob || !createdJob.id) {
          throw new Error("Trigger did not return a valid job");
        }

        setJob(createdJob);
        setRawJson(trigger.json);
        await pollJob(createdJob.id);
      } catch (runError) {
        setError(runError instanceof Error ? runError.message : "Unknown error");
      } finally {
        setBusy(false);
      }
    },
    [pollJob],
  );

  useEffect(() => {
    if (!prefillUrl) {
      return;
    }
    setUrl((current) => (current === prefillUrl ? current : prefillUrl));
  }, [prefillUrl]);

  useEffect(() => {
    if (!shouldAutorun || !prefillUrl) {
      return;
    }
    const autoRunKey = `${shouldAutorun}:${prefillUrl}`;
    if (autoRunKeysRef.current.has(autoRunKey)) {
      return;
    }
    autoRunKeysRef.current.add(autoRunKey);
    void runAnalyze(prefillUrl);
  }, [prefillUrl, runAnalyze, shouldAutorun]);

  const onRun = async (event) => {
    event.preventDefault();
    await runAnalyze(url);
  };

  return (
    <main className="tool-shell">
      <div className="tool-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand" style={{ marginBottom: 4 }}>
              URL Analyzer Tool
            </h1>
            <p className="esg-subtitle" style={{ marginTop: 0 }}>
              Utility tool: analyze URL metadata via background job.
            </p>
          </div>
          <div className="esg-link-row">
            <Link className="esg-link-chip" href="/">
              Home ESG
            </Link>
            <Link className="esg-link-chip" href="/help">
              Help
            </Link>
          </div>
        </header>

        <section className="tool-panel">
          <form onSubmit={onRun} className="esg-grid">
            <div>
              <label htmlFor="url-input" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
                URL to analyze
              </label>
              <input
                id="url-input"
                type="url"
                className="esg-input"
                placeholder="https://example.com"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </div>
            <div>
              <button type="submit" className="esg-button" disabled={busy}>
                {busy ? "Running..." : "Run analyzer"}
              </button>
            </div>
          </form>
        </section>

        {error ? (
          <section className="tool-panel">
            <p className="esg-status esg-status-error">{error}</p>
          </section>
        ) : null}

        {job ? (
          <section className="tool-panel">
            <h2 style={{ marginTop: 0 }}>Job</h2>
            <p>
              <strong>ID:</strong> {job.id}
            </p>
            <p>
              <strong>Status:</strong> {job.status}
            </p>
            <p>
              <strong>Requested:</strong> {job.requestedAt}
            </p>
            <p>
              <strong>Updated:</strong> {job.updatedAt}
            </p>
          </section>
        ) : null}

        {output ? (
          <section className="tool-panel">
            <h2 style={{ marginTop: 0 }}>Result</h2>
            <p>
              <strong>HTTP status:</strong> {String(output.httpStatus ?? "")}
            </p>
            <p>
              <strong>Final URL:</strong> {output.finalUrl ?? ""}
            </p>
            <p>
              <strong>Title:</strong> {output.title ?? ""}
            </p>
            <p>
              <strong>Description:</strong> {output.description ?? ""}
            </p>
          </section>
        ) : null}

        {rawJson ? (
          <section className="tool-panel">
            <h2 style={{ marginTop: 0 }}>Raw API payload</h2>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
              {JSON.stringify(rawJson, null, 2)}
            </pre>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default function UrlAnalyzerPage() {
  return (
    <Suspense fallback={<main className="tool-shell"><div className="tool-container">Loading...</div></main>}>
      <UrlAnalyzerClient />
    </Suspense>
  );
}
