-- The pre-existing default for operations.state was 'running', which
-- predates the 'pending' state added in 20260808200100. A freshly created
-- operation hasn't been picked up by a worker yet, so it should default
-- to 'pending', not 'running' (createInstance sets this explicitly too,
-- but the column default should be correct on its own).
alter table operations alter column state set default 'pending';
