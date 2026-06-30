Goal (incl. success criteria):
- Add a bounded batch wrapper around the existing Exa research scout so Murph can search multiple distinct user-interest lanes without broadening the final weekly message.
- Success means the tool accepts up to four compact non-identifying lane profiles, runs the existing single-scout request per lane with a small per-lane candidate cap, returns lane-tagged provider results, and the managed automation prompt uses that batch surface while still sending at most one final item.

Constraints/Assumptions:
- Keep the existing single-scout command and request recipe as the primitive; add only the minimal batch schema/CLI wrapper needed to enforce bounds.
- Preserve current privacy guarantees: compact tag profiles only, no raw labs, names, dates of birth, notes, or medical records sent externally.
- Do not add persisted state, queues, schedulers, or a second research ranking system.
- Hosted Cloudflare Exa egress must keep validating the exact bounded research-scout request shape before injecting the Worker-owned key.

Key decisions:
- The assistant chooses semantic research lanes from current context; the tool owns batch execution and hard caps.
- Keep per-lane `maxCandidates` under the existing single-call max instead of widening the Exa request contract to one larger blended search.

State:
- Implementation and verification complete; ready for finish-task commit.

Done:
- Confirmed the current scout builds one blended Exa query from profile buckets and caps total candidates per call.
- Confirmed `--maxCandidates` is currently bounded to 12 in the shared contract.
- Added shared batch schemas, CLI command, generated CLI surface, prompt updates, and focused tests.
- Verified the batch wrapper preserves the existing single-scout Exa request shape per lane and keeps final output capped at one item in the managed automation prompt.

Now:
- Close the plan through `scripts/finish-task`.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None blocking; exact response grouping will follow the smallest shape that preserves raw provider payloads and lane labels.

Working set (files/ids/commands):
- packages/contracts/src/exa-research-scout.ts
- packages/contracts/test/exa-research-scout.test.ts
- packages/cli/src/commands/research.ts
- packages/cli/src/research-scout-client.ts
- packages/cli/test/research-scout.test.ts
- packages/assistant-engine/src/assistant/managed-automations.ts
- packages/assistant-engine/test/managed-automations.test.ts
- packages/assistant-engine/test/managed-automations-core.test.ts
- pnpm typecheck
- bash scripts/workspace-verify.sh test:diff <touched paths>
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
