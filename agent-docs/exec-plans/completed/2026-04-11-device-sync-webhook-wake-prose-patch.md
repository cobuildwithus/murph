# Goal (incl. success criteria):
- Apply only the concrete, still-applicable webhook target-area changes described in the watched-thread prose reply.
- Success means the accepted-hook contract cannot silently leave claimed traces wedged, the unused shared webhook-trace payload field is removed, hosted webhook body reads enforce the same size cap as local ingress, and focused verification passes for the touched owners.

# Constraints/Assumptions:
- The watched ChatGPT export did not contain a downloadable patch or diff attachment; treat the prose summary as behavioral intent only.
- Preserve unrelated dirty worktree edits, especially the pre-existing assistant-engine test change and any overlapping `apps/web` work.
- Keep the diff scoped to the target device-sync ingress and hosted wake seam.

# Key decisions:
- Reuse the already-landed transactional hosted wake completion flow instead of reopening that architecture.
- Enforce the hook-side durable completion contract at the public-ingress boundary rather than inferring success from later retries.
- Match the hosted webhook body limit to the local device-sync ingress default rather than inventing a new hosted-specific cap.

# State:
- in_progress

# Done:
- Read the repo workflow, verification, completion, and work-with-pro instructions.
- Inspected the exported thread JSON and confirmed the missing artifact was a non-downloadable status chip, not a real attachment.
- Compared the prose-returned fixes against the current target-area source and identified the still-missing contract/body-limit changes.

# Now:
- Land the scoped device-sync and hosted-web changes with focused tests.

# Next:
- Run required verification and audit flow.
- Send the one same-thread attached review request and arm the final wake hop.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the accepted-hook completion enforcement should use an explicit hook return contract or a store-observed trace-state check until the implementation is finalized.

# Working set (files/ids/commands):
- Thread export: `output-packages/chatgpt-watch/69da4aab-5f04-83a0-960d-45387c42c568-2026-04-11T132053Z/thread.json`
- Commands: `sed`, `rg`, focused package/app verification, `pnpm review:gpt --send`, `pnpm exec cobuild-review-gpt thread wake`
- Files: `packages/device-syncd/src/{public-ingress.ts,service.ts,types.ts}`, `packages/device-syncd/test/public-ingress.test.ts`, `apps/web/src/lib/{http.ts,device-sync/public-ingress-service.ts}`, `apps/web/test/device-sync-hosted-wake-dispatch.test.ts`
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
