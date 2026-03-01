"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const NAV_ITEMS = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/sites", label: "Sites" },
  { href: "/app/personnel", label: "Personnel" },
  { href: "/app/activities", label: "Activities" },
  { href: "/app/evidence", label: "Evidence" },
  { href: "/app/assessments", label: "Assessments" },
  { href: "/app/audit", label: "Audit" },
];

const UTILITY_ITEMS = [
  { href: "/tools/url-analyzer", label: "URL Analyzer" },
  { href: "/help", label: "Help" },
];

const sortMemberships = (items) => [...items].sort((a, b) => a.tenantName.localeCompare(b.tenantName));

export default function EnterpriseShell({
  initialUser,
  initialMemberships,
  initialActiveTenantId,
  initialRole,
  children,
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState(initialUser);
  const [memberships, setMemberships] = useState(sortMemberships(initialMemberships || []));
  const [activeTenantId, setActiveTenantId] = useState(initialActiveTenantId || "");
  const [activeRole, setActiveRole] = useState(initialRole || "");
  const [loadingMe, setLoadingMe] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [message, setMessage] = useState("");

  const activeMembership = useMemo(
    () => memberships.find((item) => item.tenantId === activeTenantId) || null,
    [activeTenantId, memberships],
  );

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      setLoadingMe(true);
      try {
        const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        if (!active) {
          return;
        }

        setUser(payload.user || null);
        setMemberships(sortMemberships(Array.isArray(payload.memberships) ? payload.memberships : []));
        setActiveTenantId(payload.activeTenantId || "");
        setActiveRole(payload.activeRole || "");
      } catch (error) {
        if (!active) {
          return;
        }
        setMessage(error instanceof Error ? error.message : "Failed to refresh session context");
      } finally {
        if (active) {
          setLoadingMe(false);
        }
      }
    };

    void refresh();

    return () => {
      active = false;
    };
  }, []);

  const onSwitchTenant = async (nextTenantId) => {
    if (!nextTenantId || nextTenantId === activeTenantId) {
      return;
    }

    setSwitchingTenant(true);
    setMessage("");

    try {
      const response = await fetch("/api/v1/auth/me", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ activeTenantId: nextTenantId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setActiveTenantId(payload.activeTenantId || nextTenantId);
      setActiveRole(payload.activeRole || "");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to switch tenant");
    } finally {
      setSwitchingTenant(false);
    }
  };

  const onLogout = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="enterprise-shell">
      <aside className="enterprise-sidebar">
        <div className="enterprise-brand-wrap">
          <div className="enterprise-brand-title">ESG Enterprise</div>
          <div className="enterprise-brand-subtitle">Operational Platform</div>
        </div>

        <nav className="enterprise-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? "enterprise-nav-item enterprise-nav-item-active" : "enterprise-nav-item"}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <nav className="enterprise-nav enterprise-nav-secondary" aria-label="Utilities">
          {UTILITY_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="enterprise-nav-item enterprise-nav-item-utility">
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="enterprise-main">
        <header className="enterprise-topbar">
          <div>
            <h1 className="enterprise-topbar-title">{activeMembership?.tenantName || "No tenant selected"}</h1>
            <p className="enterprise-topbar-subtitle">
              {user?.name || "Unknown user"} · {activeRole || activeMembership?.role || "No role"}
            </p>
          </div>

          <div className="enterprise-topbar-actions">
            <label className="enterprise-inline-field" htmlFor="tenant-switcher">
              Tenant
            </label>
            <select
              id="tenant-switcher"
              className="enterprise-input"
              value={activeTenantId}
              onChange={(event) => void onSwitchTenant(event.target.value)}
              disabled={switchingTenant || loadingMe}
            >
              {memberships.map((item) => (
                <option key={item.tenantId} value={item.tenantId}>
                  {item.tenantName} ({item.role})
                </option>
              ))}
            </select>
            <button className="enterprise-button-secondary" type="button" onClick={onLogout}>
              Logout
            </button>
          </div>
        </header>

        {message ? <p className="enterprise-status enterprise-status-error">{message}</p> : null}

        <main className="enterprise-content">{children}</main>
      </section>
    </div>
  );
}
