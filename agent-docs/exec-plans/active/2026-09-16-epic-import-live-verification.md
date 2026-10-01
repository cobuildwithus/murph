# Verify Epic registration and live record imports

Status: active
Created: 2026-09-16
Updated: 2026-09-16

## Goal

Verify the automatically distributed patient-facing registration through sandbox import and an authorized real-account import with canonical lab readback.

## Current evidence

- The default policy uses the 44 APIs with explicit USCDI-v3 eligibility. Hospital-provisioned APIs remain behind the default-empty provider allowlist and separate client IDs.
- A replacement registration is prepared with patient-facing R4 access, SMART v1, a public client, no refresh/offline access, and the production callback. Both questionnaire versions are complete and Epic marks the replacement production-ready. The production Web environment now selects its public client ID; the live site still needs a fresh managed Git deployment.
- The development registration is saved for sandbox use with the same eligible APIs and the canonical local HTTPS callback.
- The existing production registration has automatic distribution disabled. A real authorization attempt failed before patient sign-in; this does not prove its exact cause or successful import.
- The shared HTTPS proxy still targets another session. A separate Chromium process successfully mapped the canonical hostname and port to an isolated TLS listener while preserving the browser origin and Host header. The shared proxy was unchanged. Use this route for the sandbox import instead of requesting proxy ownership.

- Resumption verification: provider-directory and OAuth-callback tests passed (15 tests); hosted Web typecheck passed. The first post-activation provider authorization probe still failed before patient login; this does not establish its cause. Epic documents a rolling distribution cycle of up to 12 hours.

## Next steps

1. Completed: activate the replacement after verifying all 44 APIs, patient audience, USCDI v3, R4, SMART v1, public-client settings, production callback, and no refresh/offline access.
2. Run a synthetic sandbox import through the actual connection flow using a separately owned browser and TLS listener.
3. Read back the resulting canonical records and import status, including lab values and document availability using synthetic evidence only.
4. The production client setting is updated. Complete the managed Git deployment, allow Epic distribution to propagate, and verify the deployed OAuth request selects it.
5. Have the member authenticate on the real hospital portal, then verify canonical imported labs and the visible result. Preserve private evidence locally; publish only aggregate or redacted outcomes.

## Completion bar

Passing tests, a ready registration, and a merged UI PR are insufficient. Complete only after the composed real authorization, import, and canonical lab readback succeed. Keep gaps explicit and preserve the existing consent, PKCE, frozen retrieval plan, and vault ownership boundaries.
