-- Phase 1 left `operations` select-only (nothing to insert into it yet).
-- Phase 2's createInstance Server Action runs as the creating user's own
-- session (not service role), so it needs an actual INSERT policy - same
-- role gate as project creation, since starting a provisioning operation
-- is an equivalent-weight action.
create policy "owners/admins can create operations"
  on operations for insert
  with check (has_org_role(organization_id, array['Owner', 'Admin']));
