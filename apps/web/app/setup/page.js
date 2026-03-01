"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SetupPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!tenantName.trim() || !name.trim() || !email.trim() || !password) {
      setError("All fields are required.");
      return;
    }

    if (password.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/v1/auth/setup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ tenantName, name, email, password }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const baseMessage = payload?.error || payload?.message || `HTTP ${response.status}`;
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        throw new Error(requestId ? `${baseMessage} (requestId: ${requestId})` : baseMessage);
      }

      router.replace("/app");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="enterprise-auth-shell">
      <section className="enterprise-auth-card">
        <header>
          <h1 className="enterprise-auth-title">Initialize ESG Enterprise</h1>
          <p className="enterprise-auth-subtitle">
            Primo accesso: crea tenant e amministratore per avviare la piattaforma.
          </p>
        </header>

        <form className="enterprise-form-grid" onSubmit={onSubmit} noValidate>
          <label className="enterprise-label" htmlFor="setup-tenant-name">
            Tenant name
          </label>
          <input
            id="setup-tenant-name"
            className="enterprise-input"
            type="text"
            placeholder="Acme Group"
            value={tenantName}
            onChange={(event) => setTenantName(event.target.value)}
            required
            disabled={busy}
          />

          <label className="enterprise-label" htmlFor="setup-admin-name">
            Admin name
          </label>
          <input
            id="setup-admin-name"
            className="enterprise-input"
            type="text"
            placeholder="Jane Doe"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={busy}
          />

          <label className="enterprise-label" htmlFor="setup-admin-email">
            Admin email
          </label>
          <input
            id="setup-admin-email"
            className="enterprise-input"
            type="email"
            placeholder="admin@acme.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />

          <label className="enterprise-label" htmlFor="setup-admin-password">
            Password
          </label>
          <input
            id="setup-admin-password"
            className="enterprise-input"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            disabled={busy}
          />

          {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}

          <div className="enterprise-auth-actions">
            <button className="enterprise-button-primary" type="submit" disabled={busy}>
              {busy ? "Setting up..." : "Create tenant & login"}
            </button>
            <Link className="enterprise-button-secondary" href="/login">
              Go to login
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
