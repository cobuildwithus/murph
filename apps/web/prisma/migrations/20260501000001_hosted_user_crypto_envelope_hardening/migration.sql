-- Hardening for signed per-user/per-domain hosted crypto envelopes.
-- These checks keep the DB representation aligned with the shared envelope parser.

ALTER TABLE hosted_user_crypto_envelope
  ADD CONSTRAINT hosted_user_crypto_envelope_wraps_array_nonempty CHECK (
    jsonb_typeof(signed_envelope_json->'wraps') = 'array'
    AND jsonb_array_length(signed_envelope_json->'wraps') > 0
  ),
  ADD CONSTRAINT hosted_user_crypto_envelope_authority_signature_shape CHECK (
    jsonb_typeof(signed_envelope_json->'authoritySignature') = 'object'
    AND signed_envelope_json #>> '{authoritySignature,alg}' = 'GCP-KMS-EC-P256-SHA256'
    AND length(coalesce(signed_envelope_json #>> '{authoritySignature,keyVersionName}', '')) > 0
    AND length(coalesce(signed_envelope_json #>> '{authoritySignature,signature}', '')) > 0
    AND length(coalesce(signed_envelope_json #>> '{authoritySignature,signedAt}', '')) > 0
  );

ALTER TABLE hosted_user_crypto_audit
  ADD CONSTRAINT hosted_user_crypto_audit_action_nonempty CHECK (length(action) > 0),
  ADD CONSTRAINT hosted_user_crypto_audit_actor_nonempty CHECK (length(actor) > 0),
  ADD CONSTRAINT hosted_user_crypto_audit_reason_nonempty CHECK (length(reason) > 0);
