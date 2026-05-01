-- Greenfield hosted crypto hard cut: per-user/per-domain root envelopes.
-- Root key plaintext is never stored; signed wrapped envelopes live in Postgres.

CREATE TYPE hosted_crypto_domain AS ENUM ('control', 'device', 'ingress', 'runtime');
CREATE TYPE hosted_crypto_envelope_status AS ENUM ('active', 'decrypt_only', 'retired', 'disabled');

CREATE TABLE hosted_user_crypto_envelope (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  domain hosted_crypto_domain NOT NULL,
  root_key_id TEXT NOT NULL,
  status hosted_crypto_envelope_status NOT NULL DEFAULT 'active',
  signed_envelope_json JSONB NOT NULL,
  rotated_from_root_key_id TEXT,
  activated_at TIMESTAMP(3),
  decrypt_only_at TIMESTAMP(3),
  retired_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT hosted_user_crypto_envelope_pkey PRIMARY KEY (id),
  CONSTRAINT hosted_user_crypto_envelope_root_key_id_nonempty CHECK (length(root_key_id) > 0),
  CONSTRAINT hosted_user_crypto_envelope_signed_schema CHECK (
    signed_envelope_json->>'schema' = 'murph.hosted-domain-root-key-envelope.v1'
  ),
  CONSTRAINT hosted_user_crypto_envelope_signed_domain CHECK (
    signed_envelope_json->>'domain' = domain::text
  ),
  CONSTRAINT hosted_user_crypto_envelope_signed_user CHECK (
    signed_envelope_json->>'userId' = user_id
  ),
  CONSTRAINT hosted_user_crypto_envelope_signed_root CHECK (
    signed_envelope_json->>'rootKeyId' = root_key_id
  )
);

CREATE TABLE hosted_user_crypto_audit (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  domain hosted_crypto_domain,
  root_key_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  recipient_kinds_json JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT hosted_user_crypto_audit_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX hosted_user_crypto_envelope_user_id_domain_root_key_id_key
  ON hosted_user_crypto_envelope(user_id, domain, root_key_id);

CREATE UNIQUE INDEX hosted_user_crypto_envelope_one_active_per_domain_idx
  ON hosted_user_crypto_envelope(user_id, domain)
  WHERE status = 'active';

CREATE INDEX hosted_user_crypto_envelope_user_id_domain_status_idx
  ON hosted_user_crypto_envelope(user_id, domain, status);

CREATE INDEX hosted_user_crypto_audit_user_id_created_at_idx
  ON hosted_user_crypto_audit(user_id, created_at);

CREATE INDEX hosted_user_crypto_audit_action_created_at_idx
  ON hosted_user_crypto_audit(action, created_at);

ALTER TABLE hosted_user_crypto_envelope
  ADD CONSTRAINT hosted_user_crypto_envelope_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES hosted_member(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE hosted_user_crypto_audit
  ADD CONSTRAINT hosted_user_crypto_audit_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES hosted_member(id) ON DELETE CASCADE ON UPDATE CASCADE;
