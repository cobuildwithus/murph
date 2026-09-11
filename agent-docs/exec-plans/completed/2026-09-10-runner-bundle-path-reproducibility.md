# Make runner bundle bytes independent of staging paths

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and evidence

Identical runtime inputs must have identical runner entrypoint bytes regardless
of checkout or staging path length. The same candidate measured 2,042,616 bytes
in Linux CI and 2,054,576 bytes locally; 230 emitted source-path comments times
52 additional path characters explain the entire 11,960-byte difference.
Existing Frog issue #2375 owns this recurring bundle-assembly friction.

## Owner and scope

- Set the entrypoint esbuild working directory to the canonical staged bundle,
  and resolve lazy-chunk metadata from that same physical root.
- Preserve absolute entry/output paths, package resolution, runtime probes,
  external SDK policy, static forbidden-input checks, and every byte budget.
- Add actual-esbuild regression proof and update the deployment owner note.
- No production state, credentials, deployment, or other worktree changes.

## Risk and semantics

Esbuild's working directory also resolves relative options and aliases. This
owner already supplies absolute entry/output paths, no aliases or relative
externals, and explicit tsconfig settings. Actual bundled imports and installed
external resolution must pass at both staging locations; the complete packaged
assembly must retain its existing boot and lazy-chunk probes. Canonicalizing the
staged root keeps symlinked temporary paths in that same coordinate system.

## Tasks and verification

1. Add the actual-bundler regression and prove it fails on the unchanged owner.
2. Apply the minimal option and prove identical output plus runtime resolution.
3. Run focused bundle tests, Cloudflare typecheck, normal packaged assembly,
   docs checks, and privacy/diff inspection.
4. Send the exact candidate to the parent before committing. After acceptance,
   use finish-task, push, and create a complete draft PR. Parent owns Ready,
   ReviewGPT, CI admission, and merge.

## Progress

- Dedicated guarded worktree created at the captured current main.
- Frozen dependency installation and Frog preflight completed.
- The new actual-bundler test failed on the unchanged owner: identical staged
  inputs measured 825 versus 918 entry bytes and different chunk hashes. Both
  bundles still executed their native installed-external/static-helper result.
- Parent review identified a metadata-coordinate gap in the initial option-only
  candidate. Native canonical-path fixtures reproduced a wrong lazy-chunk URL;
  ordinary macOS temporary paths hid it because they traverse a symlink.
- The owner now canonicalizes the staged root and resolves metadata against it.
  All 47 entrypoint-bundle tests pass, including ordinary and canonical temporary
  paths, byte-identical outputs across directory lengths, an actually awaited
  dynamic export, and rejection of the exact error from a poisoned lazy module.
  Existing missing-external, forbidden-import, size, and chunk-count checks pass.
- Normal packaged `pnpm --dir apps/cloudflare runner:bundle` passes all package
  builds, eight CLI parity probes, entrypoint/lazy-chunk boot probes, and final
  assembly. Startup measures 2,025,596 bytes against the unchanged 2,046,662 cap,
  with 21 of 24 chunks; entry measures 70,738 bytes against its unchanged cap.
- Cloudflare typecheck, docs drift/gardening, complexity (debt 0, max 8 unchanged),
  and diff checks pass. Scoped privacy inspection passes.
- Parent reviewed and accepted the complete source, proof, and owner-document
  candidate. Close and commit this plan with the scoped implementation; parent
  owns Ready, external review, exact-head CI, merge, and any production rollout.
Completed: 2026-09-10
