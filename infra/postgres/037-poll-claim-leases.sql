-- Poll claims create a dispatching execution before n8n accepts the request.
-- Keep those leases visible to the same recovery watchdog as accepted work.
CREATE INDEX IF NOT EXISTS action_executions_dispatching_deadline_idx
  ON action_executions (deadline_at, tenant_id)
  WHERE provider_status IN ('dispatching', 'accepted') AND deadline_at IS NOT NULL;
