import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogVersionStorage } from './catalog-identity.js';

describe('Catalog V2 action/CRM/document reference storage', () => {
  it('keeps UUID legacy catalog identity unchanged', () => {
    const uuid = '9814eac0-13e7-4550-ac5c-e2d41955bea0';
    expect(catalogVersionStorage(uuid)).toEqual({ legacy: uuid, v2: null });
    expect(catalogVersionStorage(null)).toEqual({ legacy: null, v2: null });
    expect(catalogVersionStorage(undefined)).toEqual({ legacy: null, v2: null });
  });

  it('routes canonical V2 catalog references into a distinct text column', () => {
    const ref = 'ancfz:r1:' + 'a'.repeat(64);
    expect(catalogVersionStorage(ref)).toEqual({ legacy: null, v2: ref });
  });

  it('adds references without altering historical UUID columns or dropping migrations', () => {
    const migration = readFileSync(new URL('../../../../infra/postgres/058-v2-action-catalog-identity.sql', import.meta.url), 'utf8');
    for (const table of ['action_requests', 'action_executions', 'crm_leads', 'supporting_documents']) {
      expect(migration).toContain('ALTER TABLE ' + table);
      expect(migration).toContain(table + '_catalog_v2_fk');
    }
    expect(migration).not.toMatch(/^\s*(?:DROP|DELETE|TRUNCATE|ALTER\s+COLUMN)/imu);
    expect(migration).toContain('REFERENCES intent_catalog_v2_versions(tenant_id, catalog_version_ref)');
  });

  it('gives package offerings the same additive V2 identity boundary', () => {
    const migration = readFileSync(new URL('../../../../infra/postgres/059-package-v2-catalog-identity.sql', import.meta.url), 'utf8');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS catalog_v2_version_ref');
    expect(migration).toContain('package_offerings_catalog_v2_fk');
    expect(migration).toContain('package_offerings_one_catalog_identity');
    expect(migration).not.toMatch(/^\s*(?:DROP|DELETE|TRUNCATE|ALTER\s+COLUMN)/imu);
  });

  it('publishes natural formation aliases as a new immutable development revision', () => {
    const migration = readFileSync(new URL('../../../../infra/postgres/061-anc-natural-formation-aliases.sql', import.meta.url), 'utf8');
    expect(migration).toContain('anc:r3:1de595abd94fc134b5e457113e927c323a29b89da60ffa2cf9dae0574c0d0858');
    expect(migration).toContain('set up a business');
    expect(migration).toContain("p.package_key || '-r3'");
    expect(migration).not.toMatch(/^\s*(?:DROP|DELETE|TRUNCATE|ALTER\s+COLUMN)/imu);
  });
});
