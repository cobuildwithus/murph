import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  verifyTsconfigPathMappings,
  verifyWorkspaceImportPolicy,
  verifyWorkspaceImports,
} from "./workspace-boundaries/import-policy-rules.mjs";
import {
  verifyWorkspacePackageExportTargets,
  verifyWorkspacePackageExports,
} from "./workspace-boundaries/package-export-rules.mjs";
import {
  verifyAssistantEnginePublicSourceSurface,
  verifyAssistantRuntimePublicSourceSurface,
  verifyFocusedOwnerSourceSurfaces,
} from "./workspace-boundaries/public-surface-rules.mjs";
import {
  isSiblingBuildArtifactPath,
  isWorkspaceBuildArtifactPath,
  shouldSkipDirectory,
} from "./workspace-boundaries/scanner.mjs";
import {
  verifyTypecheckScripts,
  verifyTypecheckTsconfigs,
} from "./workspace-boundaries/typecheck-rules.mjs";

export {
  isSiblingBuildArtifactPath,
  isWorkspaceBuildArtifactPath,
  shouldSkipDirectory,
  verifyWorkspaceImportPolicy,
};

export async function main() {
  const failures = [];

  await verifyTypecheckScripts(failures);
  await verifyTypecheckTsconfigs(failures);
  await verifyWorkspacePackageExports(failures);
  await verifyAssistantEnginePublicSourceSurface(failures);
  await verifyAssistantRuntimePublicSourceSurface(failures);
  await verifyFocusedOwnerSourceSurfaces(failures);
  await verifyWorkspacePackageExportTargets(failures);
  await verifyTsconfigPathMappings(failures);
  await verifyWorkspaceImports(failures);

  if (failures.length > 0) {
    console.error("Workspace boundary verification failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Workspace boundary verification passed.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
