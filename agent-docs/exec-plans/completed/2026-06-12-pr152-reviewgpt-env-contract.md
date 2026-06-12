Goal:
- Fix accepted ReviewGPT finding on PR 152: keep hosted runtime worker-contract paths from importing the Node/process-bearing assistant skill asset module just to share env-name constants.

Constraints:
- Preserve PR 152 behavior: deny `MURPH_ASSISTANT_SKILLS_ROOT` and `MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH` overrides at Cloudflare runner-secret and hosted runtime config boundaries.
- Keep Cloudflare worker bundle free of assistant-engine root imports.
- Keep constants zero-dependency where they cross hosted-runtime contract seams.

Plan:
1. Add a zero-dependency assistant skill env-name contract module.
2. Repoint asset/root consumers and runtime deny lists to the contract module where only string constants are needed, including source-resolution config for the new public subpath.
3. Add/update focused drift tests and run scoped verification.

Status: completed
- Completed. ReviewGPT finding fixed; focused tests, typecheck, scoped diff verification, smoke tests, security/privacy review, coverage-write, and task-finish review passed.
Updated: 2026-06-12
Completed: 2026-06-12
