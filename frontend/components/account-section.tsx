import { AuthPanel } from "@/components/auth-panel";
import { createClient } from "@/lib/supabase/server";

// Reads the session cookie, so it sits behind a Suspense boundary
export async function AccountSection() {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data } = await supabase.auth.getClaims();
  const email =
    typeof data?.claims.email === "string" ? data.claims.email : null;
  return <AuthPanel email={email} />;
}
