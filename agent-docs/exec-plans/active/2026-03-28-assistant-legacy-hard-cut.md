## Goal

Remove the remaining assistant config/session legacy compatibility so operator config only stores and reads provider-scoped defaults and assistant sessions only use `providerState`.

## Success Criteria

- `packages/cli/src/operator-config.ts` no longer accepts or projects flat assistant provider fields like `assistant.model` or `assistant.baseUrl`.
- `packages/cli/src/assistant/store/persistence.ts` no longer reads legacy `codexPromptVersion`.
- Assistant callers/tests use `defaultsByProvider` or provider-scoped helpers instead of top-level projected fields.
- Focused CLI verification passes; repo-wide failures, if any, are documented as unrelated.

## Scope

- `packages/cli/src/{operator-config.ts,assistant/service.ts,assistant/ui/ink.ts,assistant/store/persistence.ts}`
- Targeted CLI tests covering operator config, provider defaults, runtime/session persistence, and assistant chat defaults.

## Risks / Notes

- `packages/cli/src/operator-config.ts` overlaps another active CLI cleanup lane; preserve any adjacent edits.
- The repo currently has unrelated dirty hosted/runtime work, so repo-wide verification may still fail outside this lane.
