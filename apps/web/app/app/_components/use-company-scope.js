"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const storageKeyForTenant = (tenantId) => `esg_active_company:${tenantId}`;

const getStoredCompanyId = (tenantId) => {
  if (typeof window === "undefined" || !tenantId) {
    return "";
  }
  try {
    return window.localStorage.getItem(storageKeyForTenant(tenantId)) || "";
  } catch (_error) {
    return "";
  }
};

const persistCompanyId = (tenantId, companyId) => {
  if (typeof window === "undefined" || !tenantId) {
    return;
  }
  try {
    if (companyId) {
      window.localStorage.setItem(storageKeyForTenant(tenantId), companyId);
    } else {
      window.localStorage.removeItem(storageKeyForTenant(tenantId));
    }
  } catch (_error) {
    // ignore storage errors in restricted environments
  }
};

export const emitCompanyScopeChange = (tenantId, companyId) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("esg-company-scope-changed", {
      detail: {
        tenantId,
        companyId,
      },
    }),
  );
};

const resolveDefaultCompany = (tenantId, companies) => {
  if (!tenantId || !Array.isArray(companies) || companies.length === 0) {
    return "";
  }

  const stored = getStoredCompanyId(tenantId);
  if (stored && companies.some((item) => item.id === stored)) {
    return stored;
  }

  const holding = companies.find((item) => item.isHolding) || null;
  return holding?.id || companies[0]?.id || "";
};

export function useCompanyScope(tenantId) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    companies: [],
    activeCompanyId: "",
  });

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setState({ loading: false, error: "", companies: [], activeCompanyId: "" });
      return;
    }

    setState((current) => ({ ...current, loading: true, error: "" }));

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/companies`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const companies = Array.isArray(payload.companies) ? payload.companies : [];
      const activeCompanyId = resolveDefaultCompany(tenantId, companies);
      persistCompanyId(tenantId, activeCompanyId);

      setState({
        loading: false,
        error: "",
        companies,
        activeCompanyId,
      });

      emitCompanyScopeChange(tenantId, activeCompanyId);
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load companies",
      }));
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const onScopeChange = (event) => {
      const detail = event.detail || {};
      if (detail.tenantId !== tenantId) {
        return;
      }

      setState((current) => ({
        ...current,
        activeCompanyId: detail.companyId || "",
      }));
      persistCompanyId(tenantId, detail.companyId || "");
    };

    window.addEventListener("esg-company-scope-changed", onScopeChange);
    return () => window.removeEventListener("esg-company-scope-changed", onScopeChange);
  }, [tenantId]);

  const setActiveCompanyId = useCallback(
    (companyId) => {
      const next = typeof companyId === "string" ? companyId : "";
      setState((current) => ({
        ...current,
        activeCompanyId: next,
      }));
      persistCompanyId(tenantId, next);
      emitCompanyScopeChange(tenantId, next);
    },
    [tenantId],
  );

  const holdingCompany = useMemo(
    () => state.companies.find((item) => item.isHolding) || null,
    [state.companies],
  );

  return {
    ...state,
    holdingCompany,
    refresh,
    setActiveCompanyId,
  };
}
