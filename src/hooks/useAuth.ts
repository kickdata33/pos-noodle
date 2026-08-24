import { useContext } from "react";

import { AuthContext } from "@/lib/auth/AuthProvider";

export function useAuth() {
  return useContext(AuthContext);
}
