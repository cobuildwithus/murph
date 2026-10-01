# GPT-6 catalog bundle admission fix

## Outcome

Carry the pinned launch catalog through the existing runner bundle so production,
hosted-local, and bundle-only CI Docker contexts use identical build inputs.
Include the catalog in source fingerprinting to reject stale prepared bundles.

## Evidence and remaining work

- CI reproduced a missing catalog in the bundle-only Docker context.
- Regression tests fail before the fix: absent bundled catalog and accepted stale source fingerprint.
- Stage the catalog once at the runner artifact owner; Docker consumes that copy.
- Remove obsolete source-context exceptions and correct the deployment owner docs.
- Focused proof passes: 75 staging/fingerprint, 558 Cloudflare, 13 settings, 5 setup, and 41 automation tests. Web/Cloudflare/assistant-engine/hosted-execution/setup typechecks and complexity guard pass.
- Correct stale Terra fixtures found by broad CI while retaining saved-preference upgrade and explicit retirement rejection.
- Shared personalization contract fixtures now use active Sol so malformed tone/voice assertions reach their intended fields.
- Complete third same-thread review and exact-head CI before the authorized merge and deploy.

## Provider input evidence

Complete synthetic first requests were captured through native Codex App Server
with production prompt builders, mixed tool catalog, and generated guidance.
Individual: 153615 to 157587 bytes; estimated tokens 33280 to 34121 (+2.53%).
Group: 139221 to 143218 bytes; estimated tokens 30613 to 31472 (+2.81%).
Token estimates use gpt-tokenizer 3.4.0 o200k_base; exact GPT-6 tokenizer unavailable.
Transport cache key excluded; synthetic paths and identifiers normalized.

## Changelog

Internal packaging repair for the existing gpt6-sol-luna launch item; no second member-visible change.
Status: completed
Updated: 2026-09-22
Completed: 2026-09-22
