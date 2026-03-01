"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
      }

      router.replace("/app");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="enterprise-auth-shell">
      <section className="enterprise-auth-card">
        <header>
          <h1 className="enterprise-auth-title">Enterprise login</h1>
          <p className="enterprise-auth-subtitle">Accedi alla piattaforma ESG con il tuo account tenant.</p>
        </header>

        <form className="enterprise-form-grid" onSubmit={onSubmit}>
          <label className="enterprise-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="enterprise-input"
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />

          <label className="enterprise-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="enterprise-input"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={busy}
          />

          {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}

          <div className="enterprise-auth-actions">
            <button className="enterprise-button-primary" type="submit" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <Link className="enterprise-button-secondary" href="/setup">
              First setup
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
