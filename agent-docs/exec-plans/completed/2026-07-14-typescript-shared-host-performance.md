# TypeScript Shared-Host Performance

## Goal

Make Murph verification fast and predictable when many worktrees share one host by admitting heavy commands through one simple host-wide limit, bounding TypeScript 7 parallelism inside each admitted command, reusing safe incremental state in CI, and deleting repeated hosted-web work without weakening compatibility checks.

## Constraints

- Keep artifact correctness locks separate from host CPU admission.
- Do not signal or terminate processes that this task did not start.
- Preserve TypeScript 6 compiler-API and web-local TypeScript 5 compatibility boundaries.
- Keep clean/release workspace builds cold and preserve Next's generated-contract check.
- Do not share mutable TypeScript build-info files between live local worktrees.
- Prefer one small owner for budget resolution over duplicated shell arithmetic or per-package configuration.
- Avoid active product/runtime files owned by other ledger rows.

## Plan

1. Add a small opt-in host admission wrapper with stale-owner recovery, secret-safe diagnostics, and focused process/slot tests.
2. Centralize TypeScript 7 budget resolution and apply it to root build/typecheck paths, package/app fanout, contracts, test-runtime, Cloudflare build, and importers without affecting TypeScript 5/6 boundaries.
3. Delete the duplicate hosted-web TypeScript 7 check in acceptance and the repeated standalone Health Commons preparation.
4. Add targeted CI build-info caching, an opt-in web watch lane with an isolated cache, a TypeScript 7 editor recommendation, and a repeatable benchmark command.
5. Document the shared-host and dedicated-runner profiles, run the routed verification and completion audits, close the plan, push the PR, and complete the ReviewGPT/CI loop on the final head.

## Verification

- Focused repo-tool tests for host admission, budget resolution, orchestration, web verification, workflow cache guards, and benchmark behavior.
- `pnpm test:diff` for every touched owner where it truthfully covers the change.
- Root typecheck and clean/incremental build proof required by the verification routing.
- Required `coverage-write` completion pass, parent final review, PR CI, merge-conflict proof, and ReviewGPT rounds to zero accepted findings.

## State

Implementation, focused verification, security/privacy review, coverage-write
review, and parent final review are complete. PR CI, ReviewGPT, and merge gates
remain.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
