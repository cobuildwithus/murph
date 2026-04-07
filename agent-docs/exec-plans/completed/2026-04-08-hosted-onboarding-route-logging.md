# Hosted Onboarding Route Logging

## Goal

Improve hosted onboarding route diagnostics so unexpected route failures log safe Prisma identifiers such as error code and redacted meta, and use that detail to make local `send-code` failures debuggable without exposing request bodies or secrets.

## Why this work exists

- Local reproduction of `POST /api/hosted-onboarding/invites/<inviteCode>/send-code` produced a 500 with only `PrismaClientKnownRequestError` plus the generic hosted-onboarding internal message.
- The current shared JSON route helper intentionally collapses unexpected errors to only the constructor name, which is too little for diagnosing Prisma failures in hosted onboarding.

## Guardrails

- Keep public JSON responses unchanged unless a known domain error already maps to a structured response.
- Do not log raw request bodies, tokens, headers, invite payloads, or direct personal identifiers.
- Only expose sanitized internal log metadata that is stable and low sensitivity, such as Prisma `code`, `clientVersion`, and redacted shallow `meta`.

## Planned steps

1. Inspect the shared JSON route helper and the hosted-onboarding wrapper to find the narrowest extension point for safe internal error detail.
2. Add route-helper support for optional sanitized log detail extraction and use it for hosted-onboarding Prisma failures.
3. Add focused tests covering generic helper behavior and hosted-onboarding logging for Prisma known-request errors.
4. Run required hosted-web verification, then complete the required review and scoped commit flow.

## Verification target

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`

## Notes

- Current local Prisma CLI env reports `P1003: Database "murph_device_sync" does not exist`, which indicates local environment drift in at least one Prisma execution path. That does not by itself explain the earlier route failure class, but it reinforces the need for better route logging.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
