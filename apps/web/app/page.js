"use client";

import { useMemo, useState } from "react";

const toApiUrl = (path) => {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
};

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

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState(null);
  const [rawJson, setRawJson] = useState(null);

  const output = useMemo(() => (job && job.result && typeof job.result === "object" ? job.result : null), [job]);
  const failedInfo = useMemo(() => {
    if (!job || job.status !== "failed") {
      return null;
    }
    const errorKind = output && typeof output.errorKind === "string" ? output.errorKind : "job_failed";
    const message =
      output && typeof output.message === "string" && output.message.trim()
        ? output.message
        : job.lastError || "Job failed";
    return { errorKind, message };
  }, [job, output]);

  const pollJob = async (jobId) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await sleep(2000);
      const detailResponse = await fetch(toApiUrl(`/api/v1/jobs/${encodeURIComponent(jobId)}`), {
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
  };

  const onRun = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const targetUrl = url.trim();
      if (!targetUrl) {
        throw new Error("URL is required");
      }

      const triggerResponse = await fetch(toApiUrl("/api/v1/jobs/trigger"), {
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
  };

  return (
    <main style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>URL Analyzer Job Runner</h1>
      <p style={{ color: "#444", marginTop: 0 }}>
        Insert a URL, run a persistent background job, and inspect final output.
      </p>

      <form onSubmit={onRun} style={{ display: "grid", gap: 12, marginTop: 20 }}>
        <label htmlFor="url-input">URL to analyze</label>
        <input
          id="url-input"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          style={{ padding: 12, borderRadius: 8, border: "1px solid #bbb", fontSize: 16 }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #111",
            background: busy ? "#ddd" : "#111",
            color: busy ? "#666" : "#fff",
            cursor: busy ? "not-allowed" : "pointer",
            width: 180,
          }}
        >
          {busy ? "Running..." : "Run"}
        </button>
      </form>

      {error ? (
        <section style={{ marginTop: 20, padding: 12, border: "1px solid #d11", borderRadius: 8, background: "#fff5f5" }}>
          <strong>Error:</strong> {error}
        </section>
      ) : null}

      {job ? (
        <section style={{ marginTop: 20, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Job</h2>
          <p><strong>ID:</strong> {job.id}</p>
          <p><strong>Type:</strong> {job.jobType}</p>
          <p><strong>Status:</strong> {job.status}</p>
          <p><strong>Requested:</strong> {job.requestedAt}</p>
          <p><strong>Updated:</strong> {job.updatedAt}</p>
        </section>
      ) : null}

      {failedInfo ? (
        <section style={{ marginTop: 20, padding: 12, border: "1px solid #d11", borderRadius: 8, background: "#fff5f5" }}>
          <h2 style={{ marginTop: 0 }}>Job failed</h2>
          <p><strong>Error kind:</strong> {failedInfo.errorKind}</p>
          <p><strong>Message:</strong> {failedInfo.message}</p>
          <p>Try another URL or verify that the target is publicly reachable.</p>
        </section>
      ) : null}

      {output ? (
        <section style={{ marginTop: 20, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Result</h2>
          {job?.status === "succeeded" && output.ok === false ? (
            <p style={{ color: "#8a6d00", fontWeight: 600 }}>
              Remote URL responded with a non-2xx status. The fetch completed successfully.
            </p>
          ) : null}
          <p><strong>HTTP status:</strong> {String(output.httpStatus ?? "")}</p>
          <p><strong>Final URL:</strong> {output.finalUrl ?? ""}</p>
          <p><strong>Title:</strong> {output.title ?? ""}</p>
          <p><strong>Description:</strong> {output.description ?? ""}</p>
          <p><strong>Fetched at:</strong> {output.fetchedAt ?? ""}</p>
        </section>
      ) : null}

      {rawJson ? (
        <section style={{ marginTop: 20, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Raw API Payload</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
            {JSON.stringify(rawJson, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
