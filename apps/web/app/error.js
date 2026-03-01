"use client";

import Link from "next/link";
import { useMemo } from "react";

const readRequestIdFromDocument = () => {
  if (typeof document === "undefined") {
    return "";
  }
  const raw = document.body?.dataset?.requestId;
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
};

export default function AppError({ error, reset }) {
  const requestId = useMemo(() => readRequestIdFromDocument(), []);
  const digest = typeof error?.digest === "string" ? error.digest : "";

  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand">Something went wrong</h1>
            <p className="esg-subtitle">The page failed to render. Please retry or use the links below.</p>
          </div>
        </header>

        <section
          style={{
            marginTop: 20,
            padding: 16,
            border: "1px solid #dce3ee",
            borderRadius: 12,
            background: "#ffffffcc",
            backdropFilter: "blur(6px)",
          }}
        >
          <p style={{ marginTop: 0, marginBottom: 10 }}>
            Request ID: <code>{requestId || "not-available"}</code>
          </p>
          {digest ? (
            <p style={{ marginTop: 0, marginBottom: 10 }}>
              Digest: <code>{digest}</code>
            </p>
          ) : null}
          <div className="esg-link-row" style={{ marginTop: 8 }}>
            <button className="esg-link-chip" type="button" onClick={() => reset()}>
              Try again
            </button>
            <Link className="esg-link-chip" href="/help">
              Help
            </Link>
            <Link className="esg-link-chip" href="/login">
              Login
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
