"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ThemeSwitcher from "../app/_components/theme-switcher";
import TooltipViewportManager from "../app/_components/tooltip-viewport-manager";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setBusy(true);

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
        if (response.status === 401 || payload?.code === "INVALID_CREDENTIALS") {
          throw new Error("Invalid email or password.");
        }

        if (response.status === 409 && payload?.needsSetup === true) {
          throw new Error("Platform setup required. Complete /platform/setup first.");
        }

        const baseMessage = payload?.error || payload?.message || `HTTP ${response.status}`;
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        throw new Error(requestId ? `${baseMessage} (requestId: ${requestId})` : baseMessage);
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
      <TooltipViewportManager />
      <section className="enterprise-auth-card">
        <header>
          <h1 className="enterprise-auth-title">Enterprise login</h1>
          <p className="enterprise-auth-subtitle">Accedi alla piattaforma ESG con il tuo account tenant.</p>
        </header>
        <div className="enterprise-auth-theme-switcher">
          <ThemeSwitcher />
        </div>

        <form className="enterprise-form-grid" onSubmit={onSubmit} noValidate>
          <label className="enterprise-label" htmlFor="login-email">
            <TooltipText text="Inserisci la tua email">Email</TooltipText>
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
            <TooltipText text="Inserisci la password">Password</TooltipText>
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
            <Link className="enterprise-button-secondary" href="/platform/setup">
              First setup
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
