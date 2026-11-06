# Move hosted E2E gates to one nightly run

Status: completed
Created: 2026-11-05
Updated: 2026-11-05

## Goal

Cut private CI spend by about half without losing the check that matters most on
each path. Each production Web candidate and each Cloudflare deploy keeps a real
end-to-end message proof. Slower journeys that caught no product bug since
2026-10-01 move to one nightly run that alerts a person when it fails.

## Success criteria

- Production admission requires exactly Linq delivery and hosted Web browser smoke.
- Cloudflare deploys keep Linq delivery, runner smoke, the Codex auth guard, and
  live smoke, and drop the reminder, Codex cache-prefix, and Cloudflare test gates.
- Reminder, foreground, and Codex cache-prefix journeys run nightly against public
  main, and a failed run opens or updates a GitHub issue naming a person.
- The nightly mode and its failure alert are proven on real runners before merge.

## Scope

- In scope: the public controller lane list, its tests, and owner docs here; the
  private plan, integration, deploy, and nightly workflows in Murph Cloud.
- Out of scope: public pull request checks, which cost nothing, and deploy cadence.

## Constraints

- Technical constraints: the public controller rejects missing and unknown lanes,
  so neither repository can change alone without failing admission.
- Product/process constraints: the owner accepted that a reminder or foreground
  regression can reach production and surface the next morning.

## Risks and mitigations

1. Risk: Web admission stays red if only one repository lands.
   Mitigation: prove both PRs ready first, merge private, then merge public at once.
   The public merge triggers the recovering admission. Recovery if public cannot
   merge: revert the private PR.
2. Risk: a nightly failure goes unseen, as the iOS canary's did for weeks.
   Mitigation: the run opens or updates an issue that mentions a person, and that
   alert path is proven on the branch before merge.
3. Risk: moved lanes behave differently under the integration workflow.
   Mitigation: run the nightly mode on the private PR branch before merge.

## Tasks

1. Prove the nightly mode and the alert from the private PR branch.
2. Land the private change and this public change back to back.

## Decisions

- Merge private first. In-flight admissions already fail when private main moves,
  so this adds no new failure type, and the public merge is the recovering push.
- No transitional lane tolerance: it would add a third PR and a second review cycle
  to protect against a window of a few minutes.
- The Codex cache-prefix lane stays out of the scenario manifest, because that
  manifest also feeds full integration and the cross-repository coverage check.

## Verification

- `node --test scripts/hosted-orchestration-compatibility.test.mjs` passed, 78 of 78.
- Agent docs drift check and `pnpm complexity:diff` passed.
- Private focused tests passed: plan 31, compatibility readers 196, verify lanes 23,
  ReviewGPT gates 7, and the two workflow test files 44.
- The nightly mode passed all six lanes on real runners from the private PR branch,
  at 37 billed minutes.
- A deliberately cancelled nightly run failed the rollup and opened the real issue,
  proving the alert path. The issue-update branch is proven by a stubbed test only.
- The first post-merge admission is proved in the PR handoff, after this plan closes.
Completed: 2026-11-05
