# Load public-page authentication on intent

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Reduce unnecessary authentication JavaScript on public pages while preserving sign-in, OAuth return, consent, and sign-out recovery.

## Product UX

- Outcome: Browse public pages without downloading sign-in code until there is intent to authenticate.
- Reaches: Signed-out visitors on phone and desktop; signed-in sidebar users signing out; cold and warm sign-in, failed chunk downloads, and Telegram OAuth returns.
- Proof: Focused component tests, browser resource and interaction evidence, Web typecheck, required exact-head CI and ReviewGPT.

## Architecture and decisions

The auth dialog and homepage runtime loader already own dynamic loading, intent, retry, and session stability. Delete their automatic idle warmups and obsolete opt-in props. Retain pointer, keyboard focus, and click preparation. The sidebar owns authoritative app logout: resolve the deferred logout component before clearing that session, so a chunk failure uses the existing retry state. Keep Privy readiness and best-effort cleanup with their existing owner. No new dependency or generic loader.

## Success criteria

- Passive public browsing does not trigger auth warmups.
- Intent prepares one shared runtime and open dialogs retain their active runtime.
- Failed chunk or app logout permits retry; successful logout clears the app session, runs Privy cleanup, and refreshes.
- Existing auth accessibility, consent and OAuth tests pass.
- Browser evidence shows the deferred graph and usable cold sign-in.

## Scope

Auth loading only. Experiment image sizing has a separate PR. Audit server delays were variable and do not establish a specific server defect; preserve existing bounded concurrent reads and cache policies.

## Tasks

1. Delete idle warmups and defer sidebar logout import.
2. Update behavioral regression coverage and release note.
3. Run focused tests, typecheck, lint, complexity and browser proof.
4. Parent review, close plan, push draft PR, mark ready, start ReviewGPT concurrently with CI, resolve results.

## Verification

Pending implementation.
