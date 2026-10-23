CREATE INDEX IF NOT EXISTS action_requests_workflow_poll_idx
  ON action_requests (workflow_key, state, created_at, id)
  WHERE state IN ('approved', 'processing');

CREATE INDEX IF NOT EXISTS action_requests_workflow_binding_poll_idx
  ON action_requests (workflow_key, state, catalog_version_id, created_at, id)
  WHERE state = 'approved';
