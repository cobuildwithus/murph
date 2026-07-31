import { readFileSync } from "node:fs";

import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const managedGroupSkillsArePublicFallbacks = readFileSync(
  new URL("./skills/group-chat/SKILL.md", import.meta.url),
  "utf8",
).includes("This public fallback intentionally contains no managed");

const publicFallbackTestNamePattern = /^(?!.*(?:keeps private and shared activity interpretation in their owners|keeps group newsletter setup and opt-out behavior in the group-chat skill|keeps the new-group contact handoff natural and reactive|polls scheduled member asks to a terminal result in the current turn|registers a dedicated group newsletter editorial skill|keeps group challenge guidance aligned with selectable scoring projections)).*$/u;

export default createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "assistant-engine",
  coverageExclude: ["src/assistant/system-prompt.ts"],
  ...(managedGroupSkillsArePublicFallbacks
    ? { test: { testNamePattern: publicFallbackTestNamePattern } }
    : {}),
});
