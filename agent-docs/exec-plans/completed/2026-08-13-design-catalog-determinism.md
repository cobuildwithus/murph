# Make design catalog rendering deterministic

Status: completed
Created: 2026-08-13
Updated: 2026-08-13
Completed: 2026-08-13

## Goal

- Keep Murph's shared OTP input SSR/hydration markup deterministic and make
  `/design` a fully synthetic catalog surface that performs no footer-vitals
  network reads.

## Success criteria

- Production OTP keeps `input-otp`'s supported password-manager behavior while
  the synthetic catalog OTP disables its optional width mutation explicitly.
- Production and catalog OTP inputs carry the vendor-supported ignore
  attributes for LastPass, 1Password, Dashlane, and Bitwarden.
- `/design` renders both its route footer and footer study in an explicit
  synthetic vitals mode, while every other `SiteFooter` call retains live
  defaults.
- Focused regressions prove stable OTP SSR/hydration style and zero catalog
  footer requests.
- Focused Web tests, Web typecheck, desktop/mobile browser proof when locally
  available, diff/privacy checks, and a scoped local commit succeed.

## Scope

- In scope: shared OTP boundary, footer-vitals mode, design route/study wiring,
  focused tests, and verification evidence.
- Out of scope: OTP lifecycle state changes, production footer data behavior,
  database/provider changes, deployments, pushing, and opening a pull request.

## Constraints

- Technical constraints: use the existing `input-otp` option and existing
  footer fallback presentation; keep hooks unconditional and avoid a second
  data owner.
- Product/process constraints: work only in the sanctioned exact-head task
  checkout; preserve privacy; use focused proof; commit locally without push.

## Risks and mitigations

1. Risk: globally disabling the OTP width strategy could regress production
   password-manager behavior.
   Mitigation: retain the production default, complete the supported vendor
   ignore attributes, and scope the deterministic override to the catalog.
2. Risk: a catalog-only flag could disable public footer vitals by default.
   Mitigation: make `live` the component default and assert ordinary callers
   remain unchanged while both `/design` footer instances opt into synthetic
   mode explicitly.

## Tasks

1. Confirm the OTP mutation and footer request owners from dependency and app
   source.
2. Implement the smallest shared OTP and footer-mode boundary changes.
3. Add focused SSR/hydration and zero-request regressions.
4. Run focused Web verification, typecheck, browser/design proof when
   available, privacy/diff review, and finish the scoped commit.
5. Address accepted review findings with complete vendor ignore attributes,
   a catalog-only width-strategy override, and real controlled-component
   `hydrateRoot` proof.

## Decisions

- Preserve `input-otp`'s production password-manager strategy and opt only the
  synthetic catalog example into `pushPasswordManagerStrategy="none"`.
- Put the LastPass, 1Password, Dashlane, and Bitwarden ignore attributes on the
  production verification-code input and synthetic catalog example.
- Model footer behavior as `vitalsMode: "live" | "synthetic"`; synthetic mode
  preserves the neutral fallback visuals and skips both fetch owners.

## Verification

- Focused Vitest: 5 files and 91 tests passed, including real controlled
  `renderToString` to `hydrateRoot` proof with zero recoverable or console
  hydration diagnostics.
- Web typecheck under the repository-required Node version and scoped ESLint
  passed.
- Browser OTP proof: `/design?tab=components` returned 200 at 1440x900 and
  390x844 with a password-manager marker present before hydration. After focus,
  the input retained `width: 100%`, no clip path, all four vendor attributes,
  its label association, and zero hydration errors. Both captures were reviewed.
- Browser footer proof: `/design?tab=sections` returned 200 at both viewports,
  rendered one canonical route footer, made zero message-volume or status
  requests, and emitted zero hydration errors. Both captures were reviewed.
- Full Web Vitest: 733 files passed and 49 skipped; 9,910 tests passed and 412
  skipped.
- Final diff checks and privacy scan passed.
