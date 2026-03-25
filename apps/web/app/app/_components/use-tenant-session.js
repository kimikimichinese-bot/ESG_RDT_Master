"use client";

import { useCallback, useEffect, useState } from "react";

export function useTenantSession() {
  const [state, setState] = useState({
    loading: true,
    error: "",
    tenantId: "",
    role: "",
    platformRole: "none",
    impersonationReadOnly: false,
    memberships: [],
    availableTenants: [],
    quota: null,
    user: null,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setState({
        loading: false,
        error: "",
        tenantId: payload.activeTenantId || "",
        role: payload.activeRole || "",
        platformRole: typeof payload.platformRole === "string" ? payload.platformRole : "none",
        impersonationReadOnly: payload.impersonationReadOnly === true,
        memberships: Array.isArray(payload.memberships) ? payload.memberships : [],
        availableTenants: Array.isArray(payload.availableTenants) ? payload.availableTenants : [],
        quota: payload.quota || null,
        user: payload.user || null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load user session",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}
