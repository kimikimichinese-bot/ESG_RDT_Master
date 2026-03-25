import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LogoutPage() {
  redirect("/api/v1/auth/logout?redirectTo=/login");
}
