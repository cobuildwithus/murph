# WHOOP OAuth Refresh Diagnostics

## Goal

Make WHOOP refresh failures diagnosable through the existing redacted device-sync failure diagnostic pipeline.

Success criteria:

- WHOOP token request failures include safe request-shape metadata and response-shape metadata.
- Hosted runtime parsing and web/runtime logs preserve those fields.
- No raw token, request body, client secret, authorization header, provider payload, user id, or connection id is logged.
- Focused tests prove the fields survive provider -> hosted runtime -> web log paths.

## Constraints

- Keep the architecture simple: extend the existing diagnostic contract instead of adding a parallel logging path.
- Metadata only; no raw provider request or response bodies.
- Preserve unrelated working-tree edits.

## Plan

1. Extend WHOOP token request failure diagnostics with safe OAuth request/response shape fields.
2. Extend device-sync and hosted-runtime diagnostic types/parsers.
3. Thread the new fields through assistant-runtime and web authority redacted logs.
4. Add focused regression coverage.
5. Run focused tests and typecheck.

## Verification

- Focused device-syncd tests passed.
- Focused assistant-runtime tests passed.
- Focused hosted-web tests passed.
- Touched package/app typechecks passed.
- Repo `pnpm typecheck` is blocked by an unrelated raw health log guard failure in hosted onboarding workflow files.

## Outcome

- WHOOP token refresh failures now emit redacted request-shape diagnostics:
  client credential present, client id present, refresh credential present, encoding kind, scope presence/count, offline scope presence, and parameter count.
- WHOOP OAuth error responses now emit redacted response-shape diagnostics:
  response shape kind and whether `error` / `error_description` fields were present.
- Sanitized provider `error_description` is included in the runtime failure summary as the provider reason.
- Cloudflare container SSH was reachable at the application/instance discovery layer, but non-interactive SSH failed with key authentication. Runtime DB/log evidence remained the reliable diagnostic path.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
