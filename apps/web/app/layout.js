import "./globals.css";
import "./theme-biosphere.css"; /* BIOSPHERE THEME (canonical) */
import "./theme-mode.css";
import { headers } from "next/headers";

export const metadata = {
  title: "ESG RDT Master",
  description: "Monorepo web application workspace."
};

const themeBootstrapScript = `
(() => {
  try {
    var key = "esg-ui-theme-preference";
    var root = document.documentElement;
    root.classList.add("theme-switching");
    var saved = window.localStorage.getItem(key);
    var nextTheme = saved === "palantir" || saved === "original" ? saved : "original";
    root.dataset.theme = nextTheme;
    requestAnimationFrame(function () {
      root.classList.remove("theme-switching");
    });
  } catch (_) {
    document.documentElement.dataset.theme = "original";
    document.documentElement.classList.remove("theme-switching");
  }
})();
`;

export default function RootLayout({ children }) {
  const headerStore = headers();
  const requestId = headerStore.get("x-vercel-id") || headerStore.get("x-request-id") || "";
  return (
    <html lang="en" data-theme="original">
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body data-request-id={requestId || undefined}>{children}</body>
    </html>
  );
}
