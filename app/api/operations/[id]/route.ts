import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Lightweight authenticated endpoint that returns only an operation and its
 * stages for a given operation ID. Used by OperationProgress for targeted
 * polling instead of router.refresh() — avoids re-running the entire
 * console layout RSC tree every 3 seconds.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  noStore();
  const { id } = await params;
  const supabase = await createClient();

  // Auth check — the cookie is already present from the browser.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: operation, error: opError } = await supabase
    .from("operations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (opError || !operation) {
    return NextResponse.json(
      { error: "Operation not found" },
      { status: 404 },
    );
  }

  const { data: stages } = await supabase
    .from("operation_stages")
    .select("*")
    .eq("operation_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json(
    {
      operation,
      stages: stages ?? [],
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
