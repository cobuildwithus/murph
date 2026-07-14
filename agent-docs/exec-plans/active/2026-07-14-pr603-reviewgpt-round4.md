# PR 603 ReviewGPT Round 4 Remediation

Status: active
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Close the four validated Telegram authority and retry findings without adding a new state owner.
- Require every mutating Telegram provider call to prove one parsed current delivery target.
- Preserve accepted Telegram work across temporary current-route callback failures.
- Publish inbound-owned Telegram route changes through the existing encrypted channel-update seam.
- Revoke a valid same-identity route only for a concrete recipient-specific provider denial.

## Accepted findings

1. Mutating Telegram operations can use unsupported methods or query/body shapes and reach provider entry without an exact parsed target.
2. Temporary current-route callback failures collapse into a terminal `403`, so accepted Telegram outbox work is not retried.
3. An inbound Telegram route promotion updates web-owned routing without publishing `member.channels.updated`, leaving the managed onboarding follow-up on a stale target.
4. Generic provider `4xx` failures, including bot credential and endpoint failures, are treated as definitive member denial and can erase valid routing.

## Constraints

- Keep `getFile` as the only targetless Telegram operation.
- Reuse the existing current-route callback, assistant outbox retry policy, encrypted channel-update envelope, and routing owner.
- Do not add a queue, schema, compatibility layer, or background repair process.
- Preserve strict fail-closed provider entry: unavailable authority is retryable only because Telegram has not been called.
- Preserve explicit recipient denial as terminal and do not restore revoked routes speculatively.

## Tasks

1. Tighten Telegram method, query, content-type, body, and exact-target validation at provider entry.
2. Return a retryable status for callback timeout, transport, non-2xx, and malformed-response failures while retaining terminal route mismatch.
3. Report effective Telegram route changes from the routing mutation and transactionally append the existing channel-update envelope in the active webhook path.
4. Allowlist concrete recipient-specific direct-authorization denials and treat unrecognized provider failures as unavailable.
5. Run focused owner tests/typechecks, required completion audits, finish-task, push, CI, and exact-head ReviewGPT until clean.

## Verification log

- ReviewGPT round 4 on `e242485c54a`: four findings received and accepted after static production-path validation on the current PR patch.
- ReviewGPT round 5 on `bab5aa09cb1`: independently reproduced the same four findings with no additional accepted findings.
- Cloudflare focused tests: 249 passed.
- Web hosted-onboarding focused tests: 97 passed.
- Assistant outbox focused tests: 28 passed; related channels and outbox tests: 73 passed.
- Operator runtime helpers: 32 passed; Cloudflare runner platform tests: 119 passed; web settings, Privy, direct, and delivery authorization tests: 60 passed.
- Cloudflare, web, and assistant-engine typechecks passed; changed web files passed ESLint; `git diff --check` passed.
- Coverage-write re-audit: clean after adding terminal-denial, route-promotion, and no-churn proofs.
- Security/privacy re-audit: no validated Medium-or-higher findings; provider-entry authorization, retry classification, encrypted channel publication, sensitive logging, and deploy-skew behavior verified.
