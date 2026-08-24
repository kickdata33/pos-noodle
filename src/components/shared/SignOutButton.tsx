"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      await signOut(auth);
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSignOut} disabled={loading}>
      ออกจากระบบ
    </Button>
  );
}
