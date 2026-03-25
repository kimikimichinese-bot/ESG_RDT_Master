"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import TooltipViewportManager from "./tooltip-viewport-manager";
import { useCompanyScope } from "./use-company-scope";
import ThemeSwitcher from "./theme-switcher";

const CORE_NAV_ITEMS = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/companies", label: "Companies" },
  { href: "/app/sites", label: "Sites" },
];

const ESG_DATA_NAV_ITEMS = [
  { href: "/app/environment", label: "Environment Data" },
  { href: "/app/social", label: "Social Data" },
  { href: "/app/governance", label: "Governance" },
  { href: "/app/definitions", label: "Definition Manager" },
  { href: "/app/factors", label: "Factors" },
  { href: "/app/ghg", label: "GHG Inventory" },
  { href: "/app/emissions", label: "Emissions" },
  { href: "/app/activities", label: "Activities" },
  { href: "/app/evidence", label: "Evidence" },
];

const COMPLIANCE_NAV_ITEMS = [
  { href: "/app/standards", label: "Standards" },
  { href: "/app/ecovadis", label: "EcoVadis" },
  { href: "/app/materiality", label: "Materiality" },
  { href: "/app/exports", label: "Exports" },
  { href: "/app/settings/storage-backup", label: "Storage & Backup" },
  { href: "/app/help/year-kickoff", label: "Year Kickoff" },
  { href: "/app/assessments", label: "Assessments" },
  { href: "/app/audit", label: "Audit" },
];

const PEOPLE_OPS_NAV_ITEMS = [{ href: "/app/personnel", label: "Personnel" }];

const UTILITY_ITEMS = [
  { href: "/tools/url-analyzer", label: "URL Analyzer" },
  { href: "/help", label: "Help" },
  { href: "/help/resources", label: "Resources" },
];

const NAV_TOOLTIP_COPY = {
  Dashboard: "Vista generale ESG",
  Companies: "Gestisci le società",
  Sites: "Gestisci le sedi",
  Personnel: "Gestisci il personale",
  Standards: "Framework e mapping",
  Materiality: "Definisci i topic ESG",
  "Environment Data": "Dati ambientali",
  Factors: "Fattori di emissione",
  "GHG Inventory": "Inventario emissioni",
  Emissions: "Totali e breakdown",
  "Social Data": "KPI sociali",
  Governance: "Dati di governance",
  Evidence: "Archivio documenti",
  EcoVadis: "Assessment EcoVadis",
  Exports: "Esporta pacchetti",
  "Storage & Backup": "Configura repository evidence e backup",
  Superadmin: "Controllo piattaforma",
};

function NavItemLabel({ label }) {
  const tooltip = NAV_TOOLTIP_COPY[label] || "";
  if (!tooltip) {
    return label;
  }
  return (
    <span className="enterprise-tooltip" data-tooltip={tooltip} data-tooltip-placement="right" aria-label={tooltip}>
      {label}
    </span>
  );
}

function TooltipText({ text, children }) {
  if (!text) {
    return children;
  }
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const sortMemberships = (items) => [...items].sort((a, b) => a.tenantName.localeCompare(b.tenantName));
const sortTenants = (items) => [...items].sort((a, b) => a.tenantName.localeCompare(b.tenantName));

const normalizeReadError = async (response) => {
  const payload = await response.json().catch(() => ({}));
  const baseMessage = payload?.error || payload?.message || `HTTP ${response.status}`;
  const code = typeof payload?.code === "string" ? payload.code : "";
  return code ? `${baseMessage} [${code}]` : baseMessage;
};

const buildQuotaMessage = (quota) => {
  if (!quota?.exceeded?.any) {
    return "";
  }
  const reasons = [];
  if (quota.exceeded.evidence) {
    reasons.push("evidence storage limit");
  }
  if (quota.exceeded.users) {
    reasons.push("users limit");
  }
  if (quota.exceeded.exports) {
    reasons.push("exports/month limit");
  }
  if (quota.exceeded.jobs) {
    reasons.push("jobs/month limit");
  }
  return reasons.length > 0 ? `Quota reached: ${reasons.join(", ")}. Contact your administrator.` : "Quota reached.";
};

const isItemActive = (pathname, href) => {
  if (!pathname) {
    return false;
  }
  if (href === "/app") {
    return pathname === "/app";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

const readBrowserPathname = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.pathname || "";
};

export default function EnterpriseShell({
  initialUser,
  initialMemberships,
  initialActiveTenantId,
  initialRole,
  initialPlatformRole = "none",
  initialImpersonationReadOnly = false,
  initialAvailableTenants = [],
  children,
}) {
  const router = useRouter();
  const [pathname, setPathname] = useState(() => readBrowserPathname());

  const [user, setUser] = useState(initialUser);
  const [memberships, setMemberships] = useState(sortMemberships(initialMemberships || []));
  const [availableTenants, setAvailableTenants] = useState(sortTenants(initialAvailableTenants || []));
  const [activeTenantId, setActiveTenantId] = useState(initialActiveTenantId || "");
  const [activeRole, setActiveRole] = useState(initialRole || "");
  const [platformRole, setPlatformRole] = useState(initialPlatformRole || "none");
  const [impersonationReadOnly, setImpersonationReadOnly] = useState(initialImpersonationReadOnly === true);
  const [quota, setQuota] = useState(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [message, setMessage] = useState("");
  const companyScope = useCompanyScope(activeTenantId);

  const isSuperadmin = platformRole === "superadmin";

  const navigationGroups = useMemo(() => {
    const coreItems = isSuperadmin
      ? [...CORE_NAV_ITEMS, { href: "/app/superadmin", label: "Superadmin" }]
      : CORE_NAV_ITEMS;

    return [
      { id: "core", label: "CORE", items: coreItems },
      { id: "esg-data", label: "ESG DATA", items: ESG_DATA_NAV_ITEMS },
      { id: "compliance", label: "COMPLIANCE", items: COMPLIANCE_NAV_ITEMS },
      { id: "people-ops", label: "PEOPLE & OPS", items: PEOPLE_OPS_NAV_ITEMS },
    ];
  }, [isSuperadmin]);

  const activeTenant = useMemo(
    () => availableTenants.find((item) => item.tenantId === activeTenantId) || null,
    [activeTenantId, availableTenants],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const notifyPathChange = () => {
      setPathname(readBrowserPathname());
    };

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = (...args) => {
      const result = originalPushState(...args);
      window.dispatchEvent(new Event("esg:pathname-change"));
      return result;
    };

    window.history.replaceState = (...args) => {
      const result = originalReplaceState(...args);
      window.dispatchEvent(new Event("esg:pathname-change"));
      return result;
    };

    notifyPathChange();
    window.addEventListener("popstate", notifyPathChange);
    window.addEventListener("esg:pathname-change", notifyPathChange);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", notifyPathChange);
      window.removeEventListener("esg:pathname-change", notifyPathChange);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      setLoadingMe(true);
      try {
        const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await normalizeReadError(response));
        }
        const payload = await response.json().catch(() => ({}));
        if (!active) {
          return;
        }

        setUser(payload.user || null);
        setMemberships(sortMemberships(Array.isArray(payload.memberships) ? payload.memberships : []));
        setAvailableTenants(
          sortTenants(
            Array.isArray(payload.availableTenants) && payload.availableTenants.length > 0
              ? payload.availableTenants
              : Array.isArray(payload.memberships)
                ? payload.memberships
                : [],
          ),
        );
        setActiveTenantId(payload.activeTenantId || "");
        setActiveRole(payload.activeRole || "");
        setPlatformRole(typeof payload.platformRole === "string" ? payload.platformRole : "none");
        setImpersonationReadOnly(payload.impersonationReadOnly === true);
        setQuota(payload.quota || null);
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

  const setActiveTenantSession = async (nextTenantId, readOnly) => {
    const response = await fetch("/api/v1/auth/active-tenant", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ tenantId: nextTenantId, readOnly }),
    });
    if (!response.ok) {
      throw new Error(await normalizeReadError(response));
    }
    return response.json().catch(() => ({}));
  };

  const onSwitchTenant = async (nextTenantId) => {
    if (!nextTenantId || nextTenantId === activeTenantId) {
      return;
    }

    setSwitchingTenant(true);
    setMessage("");

    try {
      const payload = await setActiveTenantSession(nextTenantId, impersonationReadOnly);
      setActiveTenantId(payload.activeTenantId || nextTenantId);
      setActiveRole(payload.activeRole || "");
      setImpersonationReadOnly(payload.impersonationReadOnly === true);
      setQuota(payload.quota || null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to switch tenant");
    } finally {
      setSwitchingTenant(false);
    }
  };

  const onToggleReadOnly = async (nextReadOnly) => {
    if (!isSuperadmin || !activeTenantId) {
      return;
    }

    setSwitchingTenant(true);
    setMessage("");
    try {
      const payload = await setActiveTenantSession(activeTenantId, nextReadOnly);
      setImpersonationReadOnly(payload.impersonationReadOnly === true);
      setQuota(payload.quota || null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update impersonation mode");
    } finally {
      setSwitchingTenant(false);
    }
  };

  return (
    <div className="enterprise-shell">
      <TooltipViewportManager />
      <aside className="enterprise-sidebar">
        <div className="enterprise-logo-block">
          <div className="enterprise-logo-mark">ESG</div>
          <div className="enterprise-brand-wrap">
            <p className="enterprise-brand-title">Biosphere</p>
            <p className="enterprise-brand-subtitle">Blue-Sage Console</p>
          </div>
        </div>

        <nav className="enterprise-nav-stack" aria-label="Primary">
          {navigationGroups.map((group) => (
            <section key={group.id} className="enterprise-nav-group" aria-label={group.label}>
              <p className="enterprise-nav-group-title">{group.label}</p>
              <div className="enterprise-nav">
                {group.items.map((item) => {
                  const activeClass = isItemActive(pathname, item.href)
                    ? "enterprise-nav-item enterprise-nav-item-active"
                    : "enterprise-nav-item";
                  return (
                    <Link key={item.href} href={item.href} className={activeClass}>
                      <NavItemLabel label={item.label} />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
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
          <div className="enterprise-topbar-leading">
            <h1 className="enterprise-topbar-title">{activeTenant?.tenantName || "No tenant selected"}</h1>
            <p className="enterprise-topbar-subtitle">
              Workspace {activeTenant?.tenantStatus ? `· ${activeTenant.tenantStatus}` : ""}
            </p>
          </div>

          <div className="enterprise-topbar-actions">
            <ThemeSwitcher />
            <label className="enterprise-inline-field" htmlFor="tenant-switcher">
              <TooltipText text="Seleziona holding">Tenant</TooltipText>
            </label>
            <select
              id="tenant-switcher"
              className="enterprise-input"
              value={activeTenantId}
              onChange={(event) => void onSwitchTenant(event.target.value)}
              disabled={switchingTenant || loadingMe}
            >
              {availableTenants.length === 0 ? <option value="">No tenant available</option> : null}
              {availableTenants.map((item) => (
                <option key={item.tenantId} value={item.tenantId}>
                  {item.tenantName}
                  {item.role ? ` (${item.role})` : ""}
                  {item.tenantStatus && item.tenantStatus !== "active" ? ` · ${item.tenantStatus}` : ""}
                </option>
              ))}
            </select>

            <label className="enterprise-inline-field" htmlFor="company-switcher">
              <TooltipText text="Seleziona società">Company</TooltipText>
            </label>
            <select
              id="company-switcher"
              className="enterprise-input"
              value={companyScope.activeCompanyId}
              onChange={(event) => companyScope.setActiveCompanyId(event.target.value)}
              disabled={!activeTenantId || companyScope.loading || switchingTenant || loadingMe}
            >
              {companyScope.companies.length === 0 ? <option value="">No company available</option> : null}
              {companyScope.companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.isHolding ? " (Holding)" : ""}
                </option>
              ))}
            </select>

            {isSuperadmin ? (
              <label className="enterprise-checkbox-row" htmlFor="impersonation-read-only-toggle">
                <input
                  id="impersonation-read-only-toggle"
                  type="checkbox"
                  checked={impersonationReadOnly}
                  onChange={(event) => void onToggleReadOnly(event.target.checked)}
                  disabled={switchingTenant || loadingMe || !activeTenantId}
                />
                Impersonate read-only
              </label>
            ) : null}
          </div>

          <div className="enterprise-user-area">
            <div className="enterprise-user-meta">
              <span className="enterprise-user-name">{user?.name || "Unknown user"}</span>
              <span className="enterprise-user-role">
                {activeRole || activeTenant?.role || "No role"}
                {isSuperadmin ? " · Platform Superadmin" : ""}
              </span>
            </div>
            <Link className="enterprise-button-secondary" href="/app/audit">
              Review
            </Link>
            <Link className="enterprise-button-secondary" href="/logout">
              Logout
            </Link>
          </div>
        </header>

        {message ? <p className="enterprise-status enterprise-status-error">{message}</p> : null}
        {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
        {impersonationReadOnly ? (
          <p className="enterprise-warning">Read-only impersonation enabled. All write actions are blocked.</p>
        ) : null}
        {buildQuotaMessage(quota) ? <p className="enterprise-warning">{buildQuotaMessage(quota)}</p> : null}

        <main className="enterprise-content">{children}</main>
      </section>
    </div>
  );
}
