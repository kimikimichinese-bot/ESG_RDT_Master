import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getBootstrapStatus, getServerSessionState } from "../api/v1/_lib/server-auth.js";

export const dynamic = "force-dynamic";

export default async function ProjectsLayout({ children }) {
  const bootstrap = await getBootstrapStatus();
  if (bootstrap.needsSetup) {
    redirect("/setup");
  }

  const sessionState = await getServerSessionState(cookies());
  if (!sessionState.authenticated) {
    redirect("/login");
  }

  return children;
}
