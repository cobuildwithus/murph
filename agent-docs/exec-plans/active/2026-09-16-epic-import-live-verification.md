# Verify Epic registration and live record imports

Status: active
Created: 2026-09-16
Updated: 2026-09-16

## Goal

Verify the automatically distributed patient-facing registration through sandbox import and an authorized real-account import with canonical lab readback.

## Current evidence

- The default policy uses the 44 APIs with explicit USCDI-v3 eligibility. Hospital-provisioned APIs remain behind the default-empty provider allowlist and separate client IDs.
- A replacement registration is prepared with patient-facing R4 access, SMART v1, a public client, no refresh/offline access, and the production callback. Required funding answers remain pending the operator's business facts; activation has not completed.
- The development registration is saved for sandbox use with the same eligible APIs and the canonical local HTTPS callback.
- The existing production registration has automatic distribution disabled. A real authorization attempt failed before patient sign-in; this does not prove its exact cause or successful import.
- The isolated local stack responds directly, but the shared HTTPS proxy targets a different development server. Repointing it awaits explicit ownership permission; preserve unrelated processes.

## Next steps

1. Complete the required funding responses from operator-provided facts; recheck all registration fields and activate the replacement.
2. Restore the local HTTPS route within authorized ownership and run a synthetic sandbox import through the actual connection flow.
3. Read back the resulting canonical records and import status, including lab values and document availability using synthetic evidence only.
4. Configure the activated public client through the authorized deployment path, allow Epic distribution to propagate, and verify the deployed OAuth request selects it.
5. Have the member authenticate on the real hospital portal, then verify canonical imported labs and the visible result. Preserve private evidence locally; publish only aggregate or redacted outcomes.

## Completion bar

Passing tests, a ready registration, and a merged UI PR are insufficient. Complete only after the composed real authorization, import, and canonical lab readback succeed. Keep gaps explicit and preserve the existing consent, PKCE, frozen retrieval plan, and vault ownership boundaries.
