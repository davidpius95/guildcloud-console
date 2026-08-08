import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles both the OAuth code exchange and the email-verification-link
// callback - Supabase sends both through a `code` query param.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/console`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=callback_failed`);
}
