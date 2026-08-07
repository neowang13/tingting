"use client";

import { useRouter } from "next/navigation";

export function ClientLogoutButton() {
  const router = useRouter();
  return <button className="text-button" type="button" onClick={async () => {
    await fetch("/api/client/auth/logout", { method: "POST" });
    router.replace("/client/login");
    router.refresh();
  }}>Sign out</button>;
}
