You are Codex Worker R2 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker R2` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch to setup-service files plus directly required setup tests.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Make setup provisioning more data-driven across macOS/Linux and remove dead Linux apt bookkeeping without changing behavior.

Relevant files/symbols:
- `packages/cli/src/setup-services.ts`
  - `provisionMacosToolchain`
  - `provisionLinuxToolchain`
  - `ensureLinuxCommand`
  - `ensureLinuxPythonCommand`
  - `resolveAptRunner`
  - `ensureAptPackages`
- `packages/cli/src/setup-services/steps.ts`
  - `buildBaseFormulaSpecs`
  - `buildPythonFormulaSpec`
- Regression anchors:
  - `packages/cli/test/setup-cli.test.ts`

Best-guess fix:
1. Introduce a small cross-platform tool-requirement spec layer so Linux and macOS consume the same declarative tool definitions where possible.
2. Share Whisper-model and OCR step construction where possible, leaving package-manager/install mechanics platform-specific.
3. Remove dead fields from the Linux apt bookkeeping types if they are not driving behavior.

Guardrails:
- Keep existing step text/status wording stable unless a test proves a targeted update is required.
- Preserve current Linux dry-run/macOS behavior and OCR skip conditions.
- Do not reshape unrelated onboarding/setup wizard files.
