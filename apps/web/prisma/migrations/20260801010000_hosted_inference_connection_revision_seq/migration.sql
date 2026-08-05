BEGIN;
SET LOCAL lock_timeout = '5s';

-- Connection revisions are allocated from this sequence rather than
-- current-row + 1: a hard delete followed by a new save would otherwise
-- restart at revision 1, letting a stale Settings selection that observed
-- the deleted connection commit against an endpoint its caller never
-- checked. Seeded past any existing row so pre-sequence revisions also stay
-- unique.
CREATE SEQUENCE "hosted_inference_connection_revision_seq" AS INTEGER;
SELECT setval(
  'hosted_inference_connection_revision_seq',
  (SELECT COALESCE(MAX("revision"), 0) + 1 FROM "hosted_inference_connection"),
  false
);

COMMIT;
