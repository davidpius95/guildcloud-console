"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

function siteUrl() {
  // Falls back to the request's own origin in dev; set NEXT_PUBLIC_SITE_URL
  // once a real deployment exists (see docs/phase-1/operator-runbook.md).
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
}

export type AuthActionState = { error: string | null };

export async function signUpWithEmail(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl()}/callback` },
  });
  if (error) return { error: error.message };

  redirect("/verify-email");
}

export async function signInWithEmail(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect("/console");
}

export async function signInWithOAuth(provider: "google" | "github") {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${siteUrl()}/callback` },
  });
  if (error || !data.url) redirect("/sign-in?error=oauth_failed");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

// Used by the sign-in/sign-up pages to read a same-request header when
// building OAuth redirect URLs behind a proxy - kept minimal for Phase 1.
export async function currentOrigin() {
  const h = await headers();
  return h.get("origin") ?? siteUrl();
}
