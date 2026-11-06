# Require the managed proxy for canonical local HTTPS

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal

Stop hosted-local startup when automatic TLS is requested for the canonical HTTPS origin but its proxy executable or configuration is unavailable.

## Success criteria

- Missing Caddy and missing Caddyfile reject before readiness; owned children are cleaned up.
- Healthy automatic TLS, explicit proxy skipping, and ordinary direct HTTP keep working.
- Focused stack/worktree tests, harness typecheck, complexity guard, and independent review pass.

## Scope

- In scope: existing proxy startup owner, composed tests, worktree guide, and the original friction report's verified variant.
- Out of scope: foreign listener takeover, external proxy validation, deployed behavior, and claims about the historical session's Caddy availability.

## Constraints

- Keep the existing exact canonical-origin contract and explicit skip precedence.
- Use task-owned synthetic loopback services; never signal an unrelated proxy.

## Risks and mitigations

1. Requiring an optional proxy could break direct HTTP or explicitly managed setups. Gate only the canonical advertised HTTPS origin after the existing explicit skip, and cover both preserved paths.
2. A generic proxy check could take over foreign state. Add no listener mutation or takeover mechanism.

## Tasks

1. Reproduce the current missing-Caddy variant with the actual stack/readiness owners and an isolated stale upstream.
2. Add the narrow missing-dependency/configuration rejection and composed regressions.
3. Verify, review, document the precise evidence boundary, and prepare a scoped PR.

## Decisions

- The worktree and environment owners only accept the canonical local HTTPS origin. Reuse that constant rather than introducing another URL parser.
- Historical CLI availability remains unknown; this is a verified current variant rather than an exact historical-cause claim.
- The unchanged startup function remains a complexity hotspot at 123. This repair adds only checks inside the existing proxy helper; lifecycle refactoring would expand scope without improving this boundary.

## Verification

- Baseline missing-Caddy/config tests failed because startup resolved.
- Stack and worktree tests: 130 passed across two files, including all 88 stack tests.
- Hosted-local-harness typecheck: passed.
- Complexity guard: passed, unchanged debt and maximum.
- Independent parent candidate review: passed.
- Final ReviewGPT remains required but blocked by the installed tool's independently reproduced Chat/Work pre-send rejection. CI and that gate remain separate PR completion requirements.
Completed: 2026-09-28
