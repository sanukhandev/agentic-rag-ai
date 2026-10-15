ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('platform_admin', 'tenant_admin', 'tenant_editor', 'tenant_viewer', 'tenant_agent'));
