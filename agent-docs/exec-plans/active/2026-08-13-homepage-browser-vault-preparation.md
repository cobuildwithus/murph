# Make homepage browser-vault preparation payload-free

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Remove browser-vault replica download, unwrap, decryption, and retention from
  the authenticated homepage while preserving a best-effort freshness hint for
  a later dashboard visit.

## Success criteria

- The authenticated homepage sends no browser-vault replica bytes to the
  browser and performs no browser-side key generation or decryption.
- Homepage preparation runs only after the response, remains best effort, and
  reuses the existing authorized, durable browser-vault refresh handoff.
- The dashboard remains the sole browser owner of replica loading and can use a
  replica prepared by the earlier hint.
- Focused behavior tests, hosted-web typecheck, and exact-head CI pass.
- The exact pushed PR head passes the applicable ReviewGPT specialist and final
  review gates.

## Scope

- In scope: authenticated homepage scheduling, browser-vault preparation,
  focused regression coverage, and the durable architecture contract.
- Out of scope: changing replica format, dashboard loading semantics, runtime
  refresh implementation, or browser-vault authorization rules.

## Constraints

- Preserve active-member and launch-consent authority checks.
- Do not add a new queue, durable state owner, or browser request.
- Preparation must never delay the homepage response and failures must not make
  the page fail.
- Keep production and review artifacts free of member identifiers and private
  database evidence.

## Tasks

1. [x] Diagnose the authenticated-only latency and identify the replica payload
   transfer as the differentiating path.
2. [ ] Obtain an apply-ready implementation from ReviewGPT against the isolated
   candidate worktree.
3. [ ] Inspect and apply the smallest safe patch with focused regression tests
   and durable documentation.
4. [ ] Run focused verification, typecheck, and direct absence proof.
5. [ ] Push a PR candidate and complete concurrent CI and ReviewGPT gates.

## Decisions

- Reuse the existing server-owned refresh mailbox and Temporal signal instead
  of adding a lightweight client endpoint.
- Schedule preparation from the authenticated server render after the response;
  never import the browser warm store from the homepage.
- Keep stale replica reads and decryption exclusively in the dashboard's
  browser-vault provider.

## Verification

- Focused hosted-web Vitest coverage for homepage scheduling and preparation
  authority/freshness/error behavior.
- Hosted-web typecheck and diff checks after the final TypeScript edit.
- Static direct proof that the homepage graph does not reference the
  browser-vault session loader, Web Crypto key generation, decryption, or warm
  store.
- Required GitHub checks and exact-head ReviewGPT completion evidence.
