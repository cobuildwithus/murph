# Diagnose active-container provider egress timing

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Add metadata-only diagnostics and focused E2E coverage for the accepted
  provider-egress active-container caveat: after a user turn completes, while
  the hosted runtime is still in the idle checkpoint window, a no-header
  provider request from that user's active container still has an active write
  fence.
- Cover the requested stale-container denial: if the active write fence belongs
  to the same user but a different runner container, provider egress from the
  old container must be denied.

## Success criteria

- Provider egress diagnostics clearly identify no-header active-container
  authorization without logging secrets, raw headers, provider bodies, or direct
  identifiers.
- Focused tests cover the diagnostic fields for exact-header and active-container
  provider egress paths.
- Hosted-local E2E coverage exercises the intended post-turn timing: turn reply
  observed, runtime still before idle checkpoint completion, and no-header
  provider egress from the active container remains authorized by the active
  write fence.
- Cross-container stale egress is denied even for the same user.
- Provider no-header mode for OpenAI, Mapbox, Linq, Telegram, and WhatsApp does
  not call exact write-fence validation.
- The implementation does not add a provider bridge, provider attempt headers,
  or a broader per-request authority protocol.

## Scope

- In scope:
  - Cloudflare provider-egress diagnostics and focused tests.
  - Hosted-local E2E coverage for the post-turn idle checkpoint window.
  - Container-scoped active write-fence validation needed for stale-container
    denial.
  - Durable docs only if the operational contract changes materially.
- Out of scope:
  - Provider bridge work.
  - Provider egress active turn tokens.
  - Per-request attempt headers or a new provider authorization protocol.
  - Broader warm-Codex lifecycle changes.
  - Web/Temporal protocol changes.

## Constraints

- Technical constraints:
  - Preserve the existing simple active-container fallback architecture.
  - Keep the accepted same-user off-turn caveat explicit in diagnostics and
    tests instead of adding new authority machinery.
  - Do not move product/control-plane authority out of web or execution authority
    out of the Cloudflare runner.
- Product/process constraints:
  - Preserve foreground runtime priority and existing write-fence ownership.
  - Keep secrets and direct personal identifiers out of code, logs, tests, docs,
    and generated artifacts.
  - Preserve unrelated active hosted-runtime and Murph Age work.

## Risks and mitigations

1. Risk: diagnostics accidentally expose sensitive provider/request data.
   Mitigation: log only stable metadata such as mode, header presence, provider
   kind, and HTTP status classes already present in the provider-egress diagnostic.
2. Risk: the E2E becomes timing-flaky.
   Mitigation: reuse the hosted-local idle-checkpoint harness and assert the
   active fence during the explicit post-turn, pre-checkpoint-complete window
   rather than sleeping blindly.
3. Risk: solving beyond the accepted tradeoff adds unnecessary architecture.
   Mitigation: keep changes to diagnostics and tests only; no write-fence schema
   or protocol changes.

## Tasks

1. Trace no-header provider egress fallback and hosted-local idle checkpoint
   timing.
2. Add provider-egress diagnostic fields for active-container/no-header
   authorization.
3. Add focused diagnostic tests, stale-container denial coverage, no-header
   provider coverage, and a hosted-local timing E2E.
4. Run required verification, security/privacy review, coverage review, and
   final task review.
5. Close the plan and commit with `scripts/finish-task`.

## Decisions

- Do not add a provider bridge or an active turn token now; rely on the existing
  active-container fallback plus Codex RPC idle/poisoning behavior.
- Keep diagnostics metadata-only and local to provider-egress structured logs.
- Validate active-container fallback against both user and runner container name
  so a stale same-user container cannot use another container's active fence.

## Verification

- Commands to run:
  - Focused Cloudflare tests covering provider-egress diagnostics.
  - Hosted-local E2E covering the post-turn idle checkpoint window.
  - `pnpm typecheck`.
  - Either `pnpm test:diff <touched paths>` when truthful, or the app-local
    Cloudflare verification lane required by the workflow docs.
- Expected outcomes:
  - Active-container no-header provider egress is observable through safe
    diagnostics.
  - The post-turn timing window is covered without changing write-fence or
    provider authority semantics.
  - Stale same-user container egress is denied.

## Completion evidence

- `pnpm typecheck` passed.
- `git diff --check` passed.
- `pnpm test:diff` passed.
- Security/privacy re-audit: no findings.
- Task-finish re-audit: requested coverage gaps resolved.
Completed: 2026-06-03
