import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LandingPage } from "@/components/marketing/LandingPage";
import { getServerSession } from "@/lib/auth/session";
import { SHOP_SLUG_HEADER } from "@/lib/shop/shopLookupAdmin";

export default async function HomePage() {
  const session = await getServerSession();
  if (session) {
    redirect(session.appUser.role === "admin" ? "/admin" : "/pos");
  }

  // No `x-shop-slug` header means this request has no shop subdomain — the apex domain,
  // `pos-noodle.vercel.app`, or local dev — so this is the marketing/signup surface rather than
  // any particular shop's login screen (SaaS roadmap Phase 2/3: replaces a paid page-builder
  // product with a page this same Vercel deployment already serves for free).
  const hdrs = await headers();
  const isApex = !hdrs.get(SHOP_SLUG_HEADER);
  if (!isApex) redirect("/login");

  return <LandingPage />;
}
