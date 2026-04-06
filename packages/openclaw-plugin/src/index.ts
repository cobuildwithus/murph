export const MURPH_OPENCLAW_SKILL_PATH = "skills/murph/SKILL.md" as const;

export interface MurphOpenClawBundle {
  readonly packageName: "@murphai/openclaw-plugin";
  readonly bundleFormat: "claude";
  readonly skillRoot: "skills";
  readonly skillName: "murph";
  readonly recommendedInstall: "openclaw plugins install @murphai/openclaw-plugin";
  readonly requiresBins: readonly ["vault-cli"];
  readonly vaultFirst: true;
  readonly managesSeparateMurphAssistant: false;
}

export const murphOpenClawBundle = {
  packageName: "@murphai/openclaw-plugin",
  bundleFormat: "claude",
  skillRoot: "skills",
  skillName: "murph",
  recommendedInstall: "openclaw plugins install @murphai/openclaw-plugin",
  requiresBins: ["vault-cli"],
  vaultFirst: true,
  managesSeparateMurphAssistant: false,
} as const satisfies MurphOpenClawBundle;

export default murphOpenClawBundle;
