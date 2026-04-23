# Harden Linq minimized raw payloads and local-path redaction

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Funnel the exported Linq minimizers through one sanitized, allowlisted path so unsupported webhook events do not retain arbitrary raw provider payloads and direct canonical message snapshots do not bypass string redaction.
- Broaden local-path redaction to replace embedded absolute Unix and Windows path substrings instead of only whole-string user-home matches.

## Why

- `minimizeLinqWebhookEvent()` currently sanitizes but still preserves raw `event.data` for unsupported event types, which keeps arbitrary provider fields in minimized payloads.
- `minimizeLinqMessageReceivedEvent()` currently allowlists message fields but skips `sanitizeRawMetadata()`, so direct message snapshots can preserve tokens, cookies, or host-local paths inside the selected fields.
- `sanitizeRawMetadata()` currently redacts only whole strings that start with a narrow user-home pattern and misses embedded paths plus common absolute roots such as `/tmp/...` or `/root/...`.

## Scope

- `packages/messaging-ingress/src/{linq-webhook.ts,internal.ts}`
- directly coupled tests:
  - `packages/messaging-ingress/test/{linq-webhook,internal}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-linq-sanitizer-and-path-redaction.md,COORDINATION_LEDGER.md}`

## Out of scope

- the active Linq timestamp/occurred-at work in `2026-04-23-linq-unclaimed-hardening.md`
- broader raw-persistence shape redesign across `packages/inboxd` or hosted/web callers
- recipient-routing or cleanup retry behavior already owned by other active Linq rows

## Constraints

- Keep the `linq-webhook.ts` changes additive on top of the existing dirty parser-naming/timestamp edits in this worktree.
- Unsupported webhook event types should omit `data` unless a specific allowlist exists; do not preserve raw passthrough payloads in the minimized export.
- Keep the path redaction conservative enough to avoid treating ordinary URLs as local filesystem paths.

## Risks and mitigations

1. Risk: tightening unsupported-event minimization could break callers that assumed passthrough raw data survived minimization.
   Mitigation: keep all top-level event metadata intact, drop only unsupported raw `data`, and add explicit regression coverage for the new omission behavior.
2. Risk: broader path matching could over-redact non-path text.
   Mitigation: redact only absolute Unix roots and absolute drive-letter Windows paths, replace substrings rather than whole values, and add tests for embedded-path plus non-path cases.

## Tasks

1. Register the narrow Linq sanitizer/path-redaction lane and inspect the current minimizer helpers plus internal redaction coverage.
2. Route both exported Linq minimizers through one allowlisted sanitized helper and omit unsupported-event `data`.
3. Replace whole-string path matching with embedded absolute-path substring redaction for common Unix roots and drive-letter Windows paths.
4. Run truthful messaging-ingress verification, required audits, and a scoped commit if the shared dirty tree allows it cleanly.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/src/internal.ts packages/messaging-ingress/test/linq-webhook.test.ts packages/messaging-ingress/test/internal.test.ts`
- Direct proof:
  - unsupported Linq webhook event minimization omits raw `data`
  - direct `minimizeLinqMessageReceivedEvent()` output redacts embedded tokens and local paths inside allowlisted fields
  - `sanitizeRawMetadata()` replaces embedded `/home/...`, `/tmp/...`, `/root/...`, and `C:\...`-style path substrings without redacting ordinary URLs
