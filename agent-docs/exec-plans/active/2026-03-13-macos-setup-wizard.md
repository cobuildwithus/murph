# macOS one-command setup wizard

Status: active
Created: 2026-03-13
Updated: 2026-03-16

## Goal

- Add a one-command macOS setup path that can provision the local Healthy Bob runtime/toolchain, install external parser dependencies, and leave the vault ready for inbox bootstrap out of the box.

## Success criteria

- `healthybob setup` works through the published CLI bin alias and provisions the local parser stack on macOS.
- `node packages/cli/dist/bin.js setup ...` works from a checked-out repo after build, so a shell wrapper can bootstrap the workspace and then delegate to the same installer logic.
- The setup flow installs or reuses Homebrew-managed `ffmpeg`, `poppler`/`pdftotext`, and `whisper-cpp`, downloads a Whisper model, and configures the inbox parser toolchain through the existing bootstrap services.
- Apple Silicon hosts can optionally install PaddleX OCR in a managed venv; unsupported macOS architectures skip OCR with a truthful note instead of failing the whole setup.
- Focused tests cover dry-run/service orchestration and the bin/setup routing path.

## Scope

- In scope:
- CLI-local setup command/contracts/service logic
- published `healthybob` bin alias plus bin routing for the special setup entrypoint
- repo-local `scripts/setup-macos.sh` wrapper and root package script wiring
- README/runtime-doc updates that explain the new setup path and its macOS assumptions
- Out of scope:
- changing the existing `vault-cli` command graph or main Incur manifest
- non-macOS dependency managers or deployment targets
- interactive model/provider selection beyond placeholders needed for future extension

## Constraints

- Preserve adjacent edits from the active CLI routing/docs lanes.
- Reuse the existing `core.init` + `inbox.bootstrap` services rather than re-implementing parser config writing.
- Keep setup logs on stderr so machine-readable stdout remains usable.
- Prefer additive docs updates over broad command-surface rewrites because setup is intentionally routed outside the current main CLI manifest.

## Risks and mitigations

1. Risk: Homebrew and Python provisioning are environment-sensitive on macOS.
   Mitigation: make each step idempotent, expose a dry-run mode, and return a detailed step log plus notes when a capability is skipped.
2. Risk: OCR support on macOS differs by architecture.
   Mitigation: default to truthful auto-detection, only attempt PaddleX OCR on Apple Silicon, and document the skip behavior.
3. Risk: The main CLI routing lanes are actively editing `vault-cli.ts`.
   Mitigation: keep this implementation in a separate setup entrypoint reached from `bin.ts` so the main command graph does not need to move.

## Tasks

1. Add setup contracts and a macOS installer service with injected command runners for testability.
2. Route `setup` through `packages/cli/src/bin.ts` and add the `healthybob` bin alias.
3. Add a repo-level `scripts/setup-macos.sh` wrapper that ensures Node/pnpm/workspace build prerequisites, then delegates to the built CLI setup entrypoint.
4. Update README/runtime docs, add focused tests, run the completion-workflow audit prompts, and execute repo verification as far as the workspace allows.

## Verification

- Focused: package-local setup tests plus the narrowest relevant CLI build/typecheck commands first.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
