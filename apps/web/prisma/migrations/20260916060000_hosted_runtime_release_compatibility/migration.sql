-- Pure idFromName proof binds compatible releases to the original namespace.
-- This is not an object access, an inventory entry, or an execution authority.
ALTER TABLE hosted_runtime_cutover ADD COLUMN namespace_probe_id TEXT;
