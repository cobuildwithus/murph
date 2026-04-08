# Stand up a real hosted-run local container smoke

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Add a repo-owned local smoke that runs the assembled Cloudflare hosted runner image through the real hosted execution path, not a manual shell shortcut.
- Prove the isolated child-process launcher can restore a vault bundle into a temp workspace and run CLI/parser-native behavior under rebound `HOME` and `VAULT`.

## Success criteria

- `apps/cloudflare` exposes a local smoke command for the hosted runner image.
- The smoke runs an in-image entrypoint that drives the same isolated child launcher and restored-workspace contract used by hosted execution, rather than relying on an interactive shell inside `/app`.
- The smoke verifies the image exposes `murph` and `vault-cli`, and captures at least one direct hosted-run proof against a restored fixture vault.
- The smoke proves native parser tools work from the real hosted-run environment for PDF text extraction and audio transcription, including an ffmpeg normalization path.
- Targeted docs are updated anywhere the repo describes native-container verification coverage.

## Scope

- In scope:
- `apps/cloudflare/scripts/**` for the local smoke implementation
- `apps/cloudflare/package.json` for command wiring
- `apps/cloudflare/test/**` for focused smoke coverage
- minimal fixture additions under `fixtures/**` if the smoke needs real PDF/audio assets
- verification docs that describe the new coverage
- Out of scope:
- live Cloudflare deploy validation
- expanding repo-wide acceptance to always run this smoke
- broader hosted runtime refactors unrelated to the smoke seam

## Constraints

- Technical constraints:
- Exercise the real hosted execution isolation model: temp child cwd, restored workspace roots, rebound `HOME`, rebound `VAULT`.
- Preserve the existing container entrypoint contract and runner bundle assembly model.
- Keep the smoke deterministic and local-first; avoid live network dependencies inside the runtime proof.
- Product/process constraints:
- Preserve unrelated dirty worktree edits.
- Finish with targeted verification, direct scenario proof, the required final review pass, and a scoped commit.

## Risks and mitigations

1. Risk: A shell-based docker smoke could prove image contents while missing hosted-run parity.
   Mitigation: Drive the smoke through an in-image entrypoint that reuses the real isolated child launcher and restored-workspace runtime contract.
2. Risk: Real parser proof may require committed binary fixtures.
   Mitigation: Keep fixtures tiny and focused, and reuse existing bundle/runtime helpers instead of inventing a separate harness.
3. Risk: The local smoke may be too heavy for routine repo acceptance.
   Mitigation: Add it as an explicit app-local command first, then update docs to describe it as direct scenario proof rather than default acceptance.

## Tasks

1. Design the minimal hosted-job fixture and local container invocation path.
2. Implement the smoke script and package command wiring in `apps/cloudflare`.
3. Add the smallest fixture assets and focused tests needed to keep the flow stable.
4. Run targeted verification plus the direct local container smoke.
5. Complete the required review pass, fix findings, and prepare the scoped commit.

## Decisions

- The smoke must run inside the shipped image while exercising the isolated child-run path and restored workspace roots; manual `docker exec murph ...` is insufficient proof.
- The smoke entry can be purpose-built as long as it reuses the hosted launcher/runtime helpers and proves temp cwd plus rebound `HOME` and `VAULT`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir apps/cloudflare test:node -- --runInBand`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/hosted-runner-smoke.test.ts apps/cloudflare/test/hosted-runner-smoke-contract.test.ts apps/cloudflare/test/container-image-contract.test.ts`
- `pnpm --dir apps/cloudflare runner:docker:smoke`
- Expected outcomes:
- Targeted Cloudflare tests stay green.
- The direct smoke proves the real hosted-run path inside the local final image.

## Verification outcomes

- `pnpm typecheck` passed.
- `pnpm --dir apps/cloudflare test:node -- --runInBand` passed with 46 test files and 417 tests green.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/hosted-runner-smoke.test.ts apps/cloudflare/test/hosted-runner-smoke-contract.test.ts apps/cloudflare/test/container-image-contract.test.ts` passed with 3 test files and 13 tests green.
- `pnpm --dir apps/cloudflare runner:docker:smoke` passed and printed direct hosted-run evidence:
  - `childCwd=/tmp/hosted-runner-smoke-launch-...`
  - `murphBin=/app/node_modules/.bin/murph`
  - `vaultCliBin=/app/node_modules/.bin/vault-cli`
  - `pdfText="Murph hosted PDF smoke fixture"`
  - `wavTranscript="Hello Murph Smoke Test"`
  - `normalizedTranscript="Hello Murph Smoke Test"`
Completed: 2026-04-09
