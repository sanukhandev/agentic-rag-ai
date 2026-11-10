# VM deployment and database migrations

`scripts/deploy-vm.sh` pulls the selected branch, starts PostgreSQL, applies
forward-only migrations, then builds and restarts the Compose services. It does
not delete volumes or rewrite existing catalog, customer, document, quote, or
workflow data.

## First deployment against an existing VM database

Confirm the last migration already applied on the VM, then set that numeric id
in the VM `.env`:

```dotenv
DB_MIGRATION_BASELINE=071
```

Run:

```bash
./scripts/deploy-vm.sh
```

The runner records the baseline without replaying historical SQL, then applies
only later files. For a new database initialized from the Compose volume, leave
the value empty: the initialized vocabulary table lets the runner safely
recognize the current baseline.

The current branch adds `072-intent-vocabulary-learning.sql` for tenant-scoped
intent phrase candidates and `073-schema-migrations.sql` for the migration
ledger. The ledger uses PostgreSQL advisory locking and SHA-256 checksums; an
edited applied migration stops deployment instead of being replayed.

## Intent catalog data changes

SQL migrations may create or safely revise catalog-backed schema/data only when
the change is a reviewed, forward-only migration. Editable catalog content must
be uploaded through the authenticated Admin validate → draft → publish flow so
the parser, tenant scope, audit trail, catalog revision, and publication guard
remain active. Do not update `intent_catalog_v2_versions.catalog_json` manually
on the VM.

## Recovery

- If the runner reports an unknown baseline, stop and verify the database before
  setting `DB_MIGRATION_BASELINE`; never choose a higher number to silence it.
- If a checksum mismatch is reported, restore the original migration file and
  add a new numbered migration for the intended change.
- A failed migration is rolled back by its transaction; fix the migration or
  provider state, then rerun the deploy script.
- PostgreSQL remains the source of truth. Redis and application containers may
  be restarted by Compose without deleting persistent volumes.
