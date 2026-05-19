## Goal

Fix the hosted runner stale invocation authority failure where a successful
workspace checkpoint advances the child runtime workspace version while generic
side-effect writes still validate against the pre-checkpoint Durable Object
workspace version, causing later artifact uploads to be rejected.

## Constraints

- Split write-fence identity from workspace checkpoint CAS; do not add a
  parallel recovery path or broad retry workaround.
- Keep all diagnostics metadata-only and avoid raw identifiers, prompts,
  transcripts, paths, payloads, secrets, or provider responses.
- Coordinate with existing active hosted-runner work and keep the diff narrow.
- Prove the fix with a local regression before deploy.

## Plan

1. Add a focused Cloudflare runner regression for checkpoint-advanced child
   workspace version followed by artifact/write-fenced validation.
2. Patch the runner outbound write-fence path so generic side-effect
   authorization uses only attempt, generation, and user identity. Keep
   workspace version on checkpoint/restore compare-and-swap paths.
3. Run focused Cloudflare tests, typecheck, and a scoped diff verifier.
4. Deploy through `cf/:deploy:immediate`.
5. Verify production with a fresh text and redacted Workers Observability
   evidence for quick typing/reply and no retry-cap/stale-authority recurrence.

## Verification

- Pending.

## State

- Diagnosis: production logs showed repeated write-fence validation rejections
  where attempt, generation, and user matched, but workspace version did not.
  The child failure kind was `stale_invocation_authority` on `artifact_upload`,
  followed by runtime wake failure and retry-cap parking.
- Now: implement and verify the identity-only write-fence fix.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
