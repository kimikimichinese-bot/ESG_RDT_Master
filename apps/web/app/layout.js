import "./globals.css";
import "./esg.css";
import { headers } from "next/headers";

export const metadata = {
  title: "ESG RDT Master",
  description: "Monorepo web application workspace."
};

export default function RootLayout({ children }) {
  const headerStore = headers();
  const requestId = headerStore.get("x-vercel-id") || headerStore.get("x-request-id") || "";
  return (
    <html lang="en">
      <body data-request-id={requestId || undefined}>{children}</body>
    </html>
  );
}
