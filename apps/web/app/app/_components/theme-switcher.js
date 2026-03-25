"use client";

import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "esg-ui-theme-preference";

const THEME_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "palantir", label: "Dark" },
];

const isTheme = (value) => value === "original" || value === "palantir";

const readThemeFromStorage = () => {
  if (typeof window === "undefined") {
    return "original";
  }
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "original";
  } catch (_error) {
    return "original";
  }
};

const readThemeFromDom = () => {
  try {
    const domTheme = document.documentElement.dataset.theme;
    return isTheme(domTheme) ? domTheme : readThemeFromStorage();
  } catch (_error) {
    return readThemeFromStorage();
  }
};

const applyTheme = (nextTheme) => {
  if (!isTheme(nextTheme) || typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const currentlyStored = root.dataset.theme;

  root.classList.add("theme-switching");
  root.dataset.theme = nextTheme;

  try {
    if (currentlyStored !== nextTheme || window.localStorage.getItem(THEME_STORAGE_KEY) !== nextTheme) {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    }
  } catch (_error) {
    // Keep the visual update stable even if storage is unavailable.
  } finally {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove("theme-switching");
      });
    });
  }
};

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState(() => readThemeFromDom());

  useEffect(() => {
    const nextTheme = readThemeFromDom();
    setTheme((currentTheme) => (currentTheme === nextTheme ? currentTheme : nextTheme));
  }, []);

  useEffect(() => {
    try {
      applyTheme(theme);
    } catch (_error) {
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = theme;
      }
    }
  }, [theme]);

  const onThemeChange = (event) => {
    const nextTheme = event.target.value;
    if (!isTheme(nextTheme) || nextTheme === theme) {
      return;
    }
    setTheme(nextTheme);
  };

  return (
    <label className="theme-switcher enterprise-theme-switcher" htmlFor="esg-theme-switch">
      <span className="theme-switcher-label">
        <TooltipText text="Cambia tema">Theme</TooltipText>
      </span>
      <select
        id="esg-theme-switch"
        className="enterprise-input theme-switcher-select"
        value={theme}
        onChange={onThemeChange}
        aria-label="Select UI theme"
      >
        {THEME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
