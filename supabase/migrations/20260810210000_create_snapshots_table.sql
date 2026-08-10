-- Migration: 20260810210000_create_snapshots_table.sql
-- Instance snapshots table to track Proxmox snapshots per instance

CREATE TABLE IF NOT EXISTS public.instance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  name text NOT NULL,
  proxmox_snapname text NOT NULL,
  size_bytes bigint DEFAULT 0,
  state text NOT NULL DEFAULT 'creating',
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.instance_snapshots ENABLE ROW LEVEL SECURITY;

-- Select policy: Org members can view snapshots for their org
CREATE POLICY "Users can view snapshots in their org"
  ON public.instance_snapshots
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Delete policy: Org members can delete snapshots in their org
CREATE POLICY "Users can delete snapshots in their org"
  ON public.instance_snapshots
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Grant privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instance_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instance_snapshots TO service_role;
