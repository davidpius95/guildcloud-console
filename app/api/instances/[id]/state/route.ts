import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Lightweight authenticated endpoint that returns the current state of an
 * instance. Used by DeletionProgress for targeted polling instead of
 * router.refresh() — avoids re-running the entire console layout RSC tree.
 *
 * Returns { state: string } or 404 if the instance no longer exists
 * (deletion complete).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: instance } = await supabase
    .from("instances")
    .select("id, state")
    .eq("id", id)
    .maybeSingle();

  if (!instance) {
    // Instance has been fully deleted by the site worker
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  return NextResponse.json({ state: instance.state });
}
