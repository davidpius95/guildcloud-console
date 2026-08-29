import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const SESSION_REFRESH_TIMEOUT_MS = 1_500;

// Refreshes the Supabase session cookie on every request. Required by
// @supabase/ssr: Server Components can't write cookies, so this is the
// one place session refresh actually persists.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() is what actually triggers the refresh when the
  // access token is stale - do not remove even though the result isn't
  // read directly here. Proxy/middleware has a strict platform timeout, so
  // bound this optimistic refresh and let the route/layout do the actual
  // authorization work if Supabase Auth is slow.
  await Promise.race([
    supabase.auth.getUser(),
    new Promise((resolve) =>
      setTimeout(resolve, SESSION_REFRESH_TIMEOUT_MS),
    ),
  ]).catch(() => undefined);

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/console/:path*",
    "/onboarding/:path*",
  ],
};
