import { copyFile, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const HOSTED_GROUP_SKILLS_ROOT_ENV =
  "MURPH_HOSTED_GROUP_SKILLS_ROOT" as const;

export const HOSTED_GROUP_SKILL_SLUGS = [
  "group-challenge",
  "group-challenge-scorecards",
  "group-chat",
  "group-newsletter",
  "groupchat-comedy",
] as const;

const PUBLIC_BASELINE_MARKER = "murph-public-group-skill-baseline";
const MURPH_CLOUD_PACKAGE_NAME = "murph-cloud";

export interface InstallHostedGroupSkillsInput {
  bundleRoot: string;
  env?: Readonly<Record<string, string | undefined>>;
  repoRoot: string;
}

export interface InstalledHostedGroupSkills {
  skillCount: number;
}

interface MurphCloudCheckoutCandidate {
  privateRoot: string;
  skillsRoot: string;
}

export async function installHostedGroupSkills(
  input: InstallHostedGroupSkillsInput,
): Promise<InstalledHostedGroupSkills | null> {
  const sourceRoot = await resolveHostedGroupSkillsSourceRoot({
    env: input.env,
    repoRoot: input.repoRoot,
  });
  if (!sourceRoot) {
    return null;
  }

  const sourceEntries = await readdir(sourceRoot, { withFileTypes: true });
  const sourceNames = sourceEntries.map((entry) => entry.name).sort();
  const expectedNames = [...HOSTED_GROUP_SKILL_SLUGS].sort();
  if (
    sourceNames.length !== expectedNames.length
    || sourceNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new TypeError(
      `Hosted group skills root must contain exactly: ${expectedNames.join(", ")}.`,
    );
  }

  const destinationRoot = path.join(
    input.bundleRoot,
    "node_modules",
    "@murphai",
    "assistant-engine",
    "skills",
  );
  await assertRegularDirectory(
    destinationRoot,
    "Installed assistant-engine skills root",
  );

  for (const slug of HOSTED_GROUP_SKILL_SLUGS) {
    const sourceDirectory = path.join(sourceRoot, slug);
    const sourcePath = path.join(sourceDirectory, "SKILL.md");
    const destinationPath = path.join(destinationRoot, slug, "SKILL.md");

    await assertRegularDirectory(sourceDirectory, `Hosted group skill ${slug}`);
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    if (
      entries.length !== 1
      || entries[0]?.name !== "SKILL.md"
      || !entries[0].isFile()
    ) {
      throw new TypeError(`${slug} must contain exactly one regular SKILL.md file.`);
    }
    await assertRegularFile(sourcePath, `Hosted group skill ${slug}/SKILL.md`);
    await assertRegularFile(
      destinationPath,
      `Public group skill baseline ${slug}/SKILL.md`,
    );

    const source = await readFile(sourcePath, "utf8");
    if (!source.startsWith("---\n")) {
      throw new TypeError(`${slug}/SKILL.md must start with YAML frontmatter.`);
    }
    if (!new RegExp(`^name: ${slug}$`, "mu").test(source)) {
      throw new TypeError(`${slug}/SKILL.md must declare its exact skill name.`);
    }
    if (source.includes(PUBLIC_BASELINE_MARKER)) {
      throw new TypeError(`${slug}/SKILL.md is a public baseline, not a private hosted skill.`);
    }

    await copyFile(sourcePath, destinationPath);
  }

  return { skillCount: HOSTED_GROUP_SKILL_SLUGS.length };
}

export async function resolveHostedGroupSkillsSourceRoot(input: {
  env?: Readonly<Record<string, string | undefined>>;
  repoRoot: string;
}): Promise<string | null> {
  const configuredRoot = input.env?.[HOSTED_GROUP_SKILLS_ROOT_ENV]?.trim();
  if (configuredRoot) {
    const sourceRoot = path.isAbsolute(configuredRoot)
      ? configuredRoot
      : path.resolve(input.repoRoot, configuredRoot);
    await assertRegularDirectory(sourceRoot, "Hosted group skills root");
    return sourceRoot;
  }

  const candidates = uniqueMurphCloudCandidates([
    // Murph Cloud integration: private repo root with public checkout at ./murph-public.
    buildMurphCloudCandidate(path.resolve(input.repoRoot, "..")),
    // Murph Cloud deploy: public repo root with private checkout at ./murph-cloud-private.
    buildMurphCloudCandidate(path.resolve(input.repoRoot, "murph-cloud-private")),
    // Sibling local checkouts: ../murph and ../murph-cloud.
    buildMurphCloudCandidate(path.resolve(input.repoRoot, "..", "murph-cloud")),
  ]);
  const recognized: MurphCloudCheckoutCandidate[] = [];
  for (const candidate of candidates) {
    if (await isMurphCloudCheckout(candidate.privateRoot)) {
      recognized.push(candidate);
    }
  }

  if (recognized.length > 1) {
    throw new TypeError(
      `Multiple Murph Cloud checkouts are present; set ${HOSTED_GROUP_SKILLS_ROOT_ENV} explicitly.`,
    );
  }
  const checkout = recognized[0];
  if (!checkout) {
    return null;
  }

  await assertRegularDirectory(
    checkout.skillsRoot,
    `Murph Cloud checkout at ${checkout.privateRoot} is missing hosted group skills`,
  );
  return checkout.skillsRoot;
}

function buildMurphCloudCandidate(privateRoot: string): MurphCloudCheckoutCandidate {
  return {
    privateRoot,
    skillsRoot: path.join(
      privateRoot,
      "packages",
      "hosted-assistant-skills",
      "skills",
    ),
  };
}

function uniqueMurphCloudCandidates(
  candidates: readonly MurphCloudCheckoutCandidate[],
): MurphCloudCheckoutCandidate[] {
  return [...new Map(
    candidates.map((candidate) => [candidate.privateRoot, candidate]),
  ).values()];
}

async function isMurphCloudCheckout(privateRoot: string): Promise<boolean> {
  const packagePath = path.join(privateRoot, "package.json");
  let metadata;
  try {
    metadata = await lstat(packagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError(
      `Murph Cloud package marker must be a regular file, not a symlink: ${packagePath}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(packagePath, "utf8"));
  } catch (error) {
    throw new TypeError(
      `Murph Cloud package marker is not valid JSON: ${packagePath}`,
      { cause: error },
    );
  }
  return Boolean(
    parsed
    && typeof parsed === "object"
    && "name" in parsed
    && (parsed as { name?: unknown }).name === MURPH_CLOUD_PACKAGE_NAME,
  );
}

async function assertRegularDirectory(
  targetPath: string,
  label: string,
): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TypeError(`${label} does not exist.`);
    }
    throw error;
  }

  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError(`${label} must be a real directory, not a symlink.`);
  }
}

async function assertRegularFile(
  targetPath: string,
  label: string,
): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TypeError(`${label} does not exist.`);
    }
    throw error;
  }

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError(`${label} must be a regular file, not a symlink.`);
  }
}
