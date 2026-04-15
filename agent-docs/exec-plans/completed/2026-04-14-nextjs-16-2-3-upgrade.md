# Next.js 16.2.3 Upgrade

## Goal

Upgrade the hosted web app to the latest published Next.js patch release and align the directly paired framework packages without widening the current `apps/web` auth refactor.

## Scope

- `apps/web/package.json`
- `pnpm-lock.yaml`

## Constraints

- Stay on the current stable major line unless the official upgrade guidance requires a wider migration.
- Prefer a dependency-only patch refresh if the existing code already matches the current `16.2` APIs.
- Do not touch unrelated `apps/web` auth refactor files already registered in the coordination ledger.
- Keep the lockfile and package manifest changes in sync.

## Planned Shape

1. Confirm the exact latest published versions from the registry and official Next.js release notes.
2. Update `next`, `eslint-config-next`, `react`, and `react-dom` for `apps/web`.
3. Refresh the committed lockfile with pnpm.
4. Run the strongest truthful hosted-web verification lane that fits the current diff and record any pre-existing blockers.
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
