// Shared helper for onboarding API calls made from the console: attaches
// the signed-in user's Supabase access token so the server can resolve
// their tenant (see lib/server/session.ts's getCallerTenant).

import { supabase } from "@/lib/supabase";

export async function authHeaders(): Promise<Record<string, string>> {
  const sb = supabase;
  if (!sb) return { "Content-Type": "application/json" };
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// getSession() normally refreshes a merely-expired access token using the
// stored refresh token — but if the tab sat backgrounded/throttled (or the
// machine slept) long enough that the refresh token itself died too, every
// authenticated route correctly starts returning 401 "Invalid or expired
// session" while the client still believes it's signed in, since nothing
// ever told it otherwise. Call this on any 401 from our own API routes:
// clears the dead local session and sends them back to a real sign-in
// instead of leaving a stuck error box with no way forward.
export async function recoverFromExpiredSession() {
  await supabase?.auth.signOut();
  window.location.href = "/login";
}
