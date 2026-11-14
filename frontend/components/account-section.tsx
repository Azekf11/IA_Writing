import { AuthPanel } from "@/components/auth-panel";
import { createClient } from "@/lib/supabase/server";

// Holds the account chip's place, so the editor below it does not move when the session is known
export function AccountSkeleton() {
  return (
    <div
      aria-hidden
      className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
    >
      <div className="skeleton h-5 w-56 max-w-full rounded-full" />
    </div>
  );
}

// Reads the session cookie, so it sits behind a Suspense boundary
export async function AccountSection() {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data } = await supabase.auth.getClaims();
  const email =
    typeof data?.claims.email === "string" ? data.claims.email : null;
  return <AuthPanel email={email} />;
}
