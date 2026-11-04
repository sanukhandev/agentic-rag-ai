-- Repair the first local-only application of migration 062. The catalog JSON
-- is unchanged; only its persisted canonical identity was corrected.
BEGIN;

-- Clear the child reference briefly so the composite foreign key can move to
-- the corrected parent identity without disabling the constraint.
UPDATE package_offerings
SET catalog_v2_version_ref = NULL
WHERE catalog_v2_version_ref = 'anc:r4:37cb77dfc7bb83f7230fca5a3c4a8842f7232753fd363ca129b86247824f077b';

UPDATE intent_catalog_v2_versions
SET catalog_version_ref = 'anc:r4:498ab48687d73b5d5da76d60bd2c6df6132fd1334e86742b16ad0e5688db261c',
    source_hash = '498ab48687d73b5d5da76d60bd2c6df6132fd1334e86742b16ad0e5688db261c'
WHERE catalog_version_ref = 'anc:r4:37cb77dfc7bb83f7230fca5a3c4a8842f7232753fd363ca129b86247824f077b';

UPDATE package_offerings
SET catalog_v2_version_ref = 'anc:r4:498ab48687d73b5d5da76d60bd2c6df6132fd1334e86742b16ad0e5688db261c'
WHERE catalog_v2_version_ref IS NULL
  AND package_key LIKE '%-r4';

COMMIT;
