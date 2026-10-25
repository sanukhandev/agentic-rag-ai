ALTER TABLE document_processing_jobs
  ADD COLUMN IF NOT EXISTS processing_token uuid;

-- Existing rows receive a stable initial token. Application claims and retries
-- rotate it before the worker can perform another callback.
UPDATE document_processing_jobs
SET processing_token = md5(id::text)::uuid
WHERE processing_token IS NULL;

ALTER TABLE document_processing_jobs
  ALTER COLUMN processing_token SET NOT NULL;
