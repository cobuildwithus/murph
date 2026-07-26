# Automatic meal enrollment stale-consent recovery

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Let an existing, active Murph member with both historical launch grants
  enroll in explicit automatic meal capture even when a later legal-document
  revision has made that acceptance stale.
- Keep members with zero or partial historical launch consent fail-closed.
- Preserve the existing active-member, private direct-route, scoped credential,
  and current upload-time authority checks.

## Root-cause evidence

- Two production enrollment attempts in the reported minute resolved the
  Privy principal to a hosted member and then returned
  `HOSTED_CONSENT_REQUIRED`; member resolution, billing, direct-route lookup,
  and credential issuance were not the failure.
- The July 23 legal release moved companion device sync and recurring
  meal-photo uploads to historical launch consent because those native
  surfaces have no current-document consent UI, but left first enrollment on
  the current-document gate.
- Production aggregate inspection found 71 members with both historical launch
  grants, of whom 45 have stale document versions and 26 have current versions.
  No member identifiers or row contents were retained.

## Scope

- `apps/web/app/api/device-sync/companion/meal-photo-capture/enrollment/route.ts`
- Focused enrollment route coverage.
- Current consent/security documentation that owns this boundary.

## Invariants

- Enrollment still requires verified foreground Privy bearer authentication,
  active hosted access, both historical launch scopes, and a current private
  delivery route.
- A stale document version is not equivalent to absent consent.
- Revocation remains available after access or consent loss.
- Scoped uploads continue to recheck active access and historical launch
  consent before commit.
- No new state, schema, credential, compatibility shim, or native-app
  authority is introduced.

## Verification

- Focused hosted-web enrollment route tests.
- Canonical `pnpm test:diff` for the touched Web slice.
- Canonical `pnpm verify:acceptance` because automatic meal capture spans
  multiple owners and this change alters an auth/consent trust boundary.
- Direct production-log and aggregate-database evidence remains read-only and
  private.

## Completion

- Run the required preliminary coverage ReviewGPT pass on the exact pushed
  head.
- Run parent final review and the final ReviewGPT trust-boundary gate.
- Close this plan with `scripts/finish-task` after final verification.
