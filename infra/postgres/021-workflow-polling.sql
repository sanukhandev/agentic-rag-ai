CREATE INDEX IF NOT EXISTS action_requests_workflow_poll_idx
  ON action_requests (workflow_key, state, created_at, id)
  WHERE state IN ('approved', 'processing');
