Goal (incl. success criteria):
- Upgrade hosted web from Next 16.2.3 to 16.2.4, preserve the lockfile, disable the dev Turbopack filesystem cache by default after the patch still reproduced stale Server Component output, restart localhost, and let the user verify homepage copy refresh behavior.

Constraints/Assumptions:
- Keep the change scoped to hosted web dev-server/cache behavior, the Next patch upgrade, and directly coupled tests.
- Turbopack filesystem cache may remain available behind explicit `MURPH_NEXT_DEV_FILESYSTEM_CACHE=1`.
- Preserve unrelated dirty-tree edits.

Key decisions:
- Use the patch release because Next reports 16.2.4 as the latest stable and its release includes Turbopack watcher/cache-adjacent fixes.
- Disable the dev filesystem cache by default because 16.2.4 still served stale homepage Server Component output with the cache enabled.
- Keep the local dev wrapper alive after Next boots because the Next CLI import returns before the dev server exits; otherwise the custom lock is released while `next-server` remains active.
- Add an outer dev-script trap for `.next-dev/.dev-server.lock` because terminal Ctrl-C through the Vercel/pnpm wrapper stack can bypass the dev-local owner's normal Node cleanup path.

State:
- Verified; awaiting final review and handoff.

Done:
- Investigated stale homepage copy and confirmed stale server route chunk wiring with filesystem cache.
- Upgraded `next` and `eslint-config-next` to 16.2.4.
- Confirmed the stale homepage copy still reproduced with filesystem cache enabled.
- Disabled the filesystem cache default with explicit env opt-in.
- Fixed orphan dev-wrapper cleanup and lock lifetime in `apps/web/scripts/dev-local.ts`.
- Added a `dev:local-env` shell trap so terminal Ctrl-C removes the lock after killing the wrapper stack.
- Verified `localhost:3000` source, generated SSR chunk, and HTTP output match after edits.
- Verified a second `pnpm --dir apps/web dev` fails on the active lock instead of spawning another tree.
- Verified Ctrl-C leaves no dev wrapper processes, no port listener, and no `.dev-server.lock`.
- Ran focused app typecheck, lint, and Vitest checks.

Now:
- Final review/handoff.

Next:
- Close or archive the plan if the task is committed or explicitly left uncommitted.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Turbopack will still occasionally miss editor save events; controlled normal and atomic-save edits updated successfully after the dev-wrapper lock fix.

Working set (files/ids/commands):
- `apps/web/package.json`
- `apps/web/next-artifacts.ts`
- `apps/web/scripts/dev-local.ts`
- `apps/web/src/components/homepage/hero-section.tsx`
- `apps/web/test/next-config.test.ts`
- `apps/web/test/page.test.ts`
- `pnpm-lock.yaml`
- `pnpm --dir apps/web dev`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/dev-local.test.ts apps/web/test/next-config.test.ts apps/web/test/page.test.ts`
- `pnpm --dir apps/web lint`
