ALTER TABLE supporting_documents
  ADD COLUMN IF NOT EXISTS store_extracted_text boolean NOT NULL DEFAULT true;
