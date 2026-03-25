"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const DEFAULT_OWNER = "WindwardNexus Labs";

export default function PlatformSetupPage() {
  const router = useRouter();
  const [ownerName, setOwnerName] = useState(DEFAULT_OWNER);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const checkBootstrap = async () => {
      try {
        const response = await fetch("/api/v1/auth/bootstrap", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!active) {
          return;
        }
        if (response.ok && payload.needsPlatformSetup === false) {
          router.replace("/login");
          return;
        }
      } catch (_error) {
        // Ignore bootstrap read errors here; submission path will still report detailed failures.
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    };
    void checkBootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!ownerName.trim() || !name.trim() || !email.trim() || !password) {
      setError("All fields are required.");
      return;
    }
    if (password.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/platform/bootstrap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ownerName,
          name,
          email,
          password,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const baseMessage = payload?.error || payload?.message || `HTTP ${response.status}`;
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        throw new Error(requestId ? `${baseMessage} (requestId: ${requestId})` : baseMessage);
      }

      router.replace(payload?.redirectTo || "/app/superadmin");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Platform bootstrap failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="enterprise-auth-shell">
      <section className="enterprise-auth-card">
        <header>
          <h1 className="enterprise-auth-title">Platform setup</h1>
          <p className="enterprise-auth-subtitle">
            Initial bootstrap for the WindwardNexus Labs Superadmin console.
          </p>
        </header>

        <form className="enterprise-form-grid" onSubmit={onSubmit} noValidate>
          <label className="enterprise-label" htmlFor="platform-owner-name">
            Owner name
          </label>
          <input
            id="platform-owner-name"
            className="enterprise-input"
            type="text"
            placeholder={DEFAULT_OWNER}
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
            required
            disabled={busy}
          />

          <label className="enterprise-label" htmlFor="platform-admin-name">
            Superadmin name
          </label>
          <input
            id="platform-admin-name"
            className="enterprise-input"
            type="text"
            placeholder="Platform Owner"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={busy}
          />

          <label className="enterprise-label" htmlFor="platform-admin-email">
            Superadmin email
          </label>
          <input
            id="platform-admin-email"
            className="enterprise-input"
            type="email"
            placeholder="owner@windwardnexuslabs.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />

          <label className="enterprise-label" htmlFor="platform-admin-password">
            Password
          </label>
          <input
            id="platform-admin-password"
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
          {checking ? <p className="enterprise-status">Checking platform bootstrap status...</p> : null}

          <div className="enterprise-auth-actions">
            <button className="enterprise-button-primary" type="submit" disabled={busy || checking}>
              {busy ? "Bootstrapping..." : "Create superadmin"}
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
