"use client";

import Link from "next/link";
import { useMemo } from "react";

const extractRequestId = (error) => {
  const text = typeof error?.message === "string" ? error.message : "";
  if (!text) {
    return typeof error?.digest === "string" ? error.digest : null;
  }
  const match = text.match(/requestId[:=]\s*([a-zA-Z0-9._:-]+)/i);
  if (match?.[1]) {
    return match[1];
  }
  return typeof error?.digest === "string" ? error.digest : null;
};

export default function GlobalError({ error, reset }) {
  const requestId = useMemo(() => extractRequestId(error), [error]);

  return (
    <main className="enterprise-shell" style={{ minHeight: "100vh", padding: "3rem 1rem" }}>
      <section className="enterprise-card" style={{ maxWidth: 640, margin: "0 auto", padding: "1.5rem" }}>
        <h1 className="enterprise-topbar-title">Something went wrong</h1>
        <p className="enterprise-topbar-subtitle" style={{ marginTop: "0.5rem" }}>
          We could not complete your request. You can retry, open help, or sign in again.
        </p>
        <p style={{ marginTop: "0.75rem" }}>
          Request ID: <code>{requestId || "not-available"}</code>
        </p>
        <div className="enterprise-topbar-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="enterprise-button-primary" onClick={reset}>
            Retry
          </button>
          <Link href="/help" className="enterprise-button-secondary">
            Help
          </Link>
          <Link href="/login" className="enterprise-button-secondary">
            Login
          </Link>
        </div>
      </section>
    </main>
  );
}
