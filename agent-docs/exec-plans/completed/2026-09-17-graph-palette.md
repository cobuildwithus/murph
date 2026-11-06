# Graph palette and completion caption follow-up

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Outcome and scope

Extend PR #3515 with chart styling drawn from `DESIGN.md` and `PRODUCT.md`.
Keep the existing image-generation and delivery owners, group reply behavior,
privacy rules, and plan gates. No new renderer, state, dependency, or protocol.

## Decisions and evidence

- Put cream, slate, sage, and sand colors plus typography and flat styling in
  the image tool description. Distinguish series with sage/slate and markers.
- Put numeric caption guidance on the attachment tool, which owns the final
  response. Remove the conflicting generic prohibition on repeating visuals.
- Preserve the short launch acknowledgement. Extend the existing live graph
  journey through trusted completion; synthetic pixels replace provider output.
- Require the used palette and typography without requiring reference lines
  when the chart does not need them. Exclude palette hex codes from data counts.
- Update the group behavior owner and existing graph changelog entry.

## Product UX proof

Ready for the tested model journeys: an earlier direct question survives an
aside; a withdrawn question stays quiet; a requested graph launches once,
uses the documented styling, attaches once, and returns correct endpoint
values in text. Real image pixels and messaging-provider delivery were not
exercised by these synthetic-boundary journeys.

## Verification

- 241 focused Assistant Engine tests, 10 changelog tests, two input measurements.
- Assistant Engine and Web typechecks passed; Web first needed its ordinary
  generated Health Commons input. Root-scoped changelog testing uses the known
  workaround in Frog entry `20260911184822-documented-changelog-test`.
- Three focused real-Codex journeys passed with `gpt-5.6-terra` and local
  subscription auth. Initial profiles failed before actions; the usable profile
  remained selected for all subsequent semantic runs.
- Final complete input delta against PR base: +640 bytes in both scopes
  (+0.43% direct, +0.47% group). Exact token counts unavailable.
- Complexity unchanged. Parent review found no additional required code change.
- PR #3515 owns final-head CI and merge status. Final ReviewGPT is exempt for
  prompt-primary work; merge remains outside this follow-up.
Completed: 2026-09-17
