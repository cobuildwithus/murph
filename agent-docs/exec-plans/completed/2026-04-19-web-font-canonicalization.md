## Title

Restore canonical Next.js runtime font loading for hosted web while keeping static local OG assets.

## Goal

Move `apps/web` runtime typography back to the canonical `next/font/google` path so the app uses Next-managed self-hosted Google fonts again, while preserving local static font files only for the OG image path that cannot rely on runtime font imports.

## Scope

- `apps/web/app/layout.tsx`
- `apps/web/app/font-assets.ts`
- `apps/web/app/fonts/**` only if runtime-only assets become unused
- focused `apps/web` tests that cover the root layout and OG image font loading

## Constraints

- Keep the visual font families unchanged for the live app: Fraunces, DM Sans, and DM Mono.
- Do not regress the existing OG image path that intentionally reads local font files.
- Prefer the canonical Next.js font-loading path over custom preload or manual `@font-face` work.
- Keep the diff narrow and avoid unrelated onboarding or homepage UI edits.

## Verification

- `pnpm --dir apps/web verify`

## Notes

- `next/font/google` already self-hosts Google fonts at build time, so the runtime goal here is to restore the documented Next path rather than hand-managing local browser font assets.
- Local static font files may still remain appropriate for `next/og`, where file reads are explicit and separate from browser font loading.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
