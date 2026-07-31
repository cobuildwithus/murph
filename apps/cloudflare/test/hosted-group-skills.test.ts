import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_GROUP_SKILLS_ROOT_ENV,
  HOSTED_GROUP_SKILL_SLUGS,
  installHostedGroupSkills,
} from "../scripts/hosted-group-skills.js";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-group-skills-"));
  temporaryRoots.push(root);
  return root;
}

async function writeSkill(
  skillsRoot: string,
  slug: (typeof HOSTED_GROUP_SKILL_SLUGS)[number],
  body: string,
): Promise<void> {
  const directory = path.join(skillsRoot, slug);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${slug}\ndescription: ${slug} guidance\n---\n\n${body}\n`,
    "utf8",
  );
}

async function createBundleWithBaselines(root: string): Promise<string> {
  const bundleRoot = path.join(root, "bundle");
  const skillsRoot = path.join(
    bundleRoot,
    "node_modules",
    "@murphai",
    "assistant-engine",
    "skills",
  );
  for (const slug of HOSTED_GROUP_SKILL_SLUGS) {
    await writeSkill(
      skillsRoot,
      slug,
      `<!-- murph-public-group-skill-baseline:v1 -->\npublic ${slug}`,
    );
  }
  return bundleRoot;
}

async function createPrivateSkillsAt(skillsRoot: string): Promise<string> {
  for (const slug of HOSTED_GROUP_SKILL_SLUGS) {
    await writeSkill(skillsRoot, slug, `private ${slug}`);
  }
  return skillsRoot;
}

async function writeMurphCloudMarker(privateRoot: string): Promise<void> {
  await mkdir(privateRoot, { recursive: true });
  await writeFile(
    path.join(privateRoot, "package.json"),
    `${JSON.stringify({ name: "murph-cloud", private: true }, null, 2)}\n`,
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("hosted group skills", () => {
  it("leaves the public baselines untouched when no Murph Cloud checkout is present", async () => {
    const repoRoot = await createTemporaryRoot();
    const bundleRoot = await createBundleWithBaselines(repoRoot);

    await expect(installHostedGroupSkills({
      bundleRoot,
      env: {},
      repoRoot,
    })).resolves.toBeNull();

    const sample = await readFile(
      path.join(
        bundleRoot,
        "node_modules",
        "@murphai",
        "assistant-engine",
        "skills",
        "group-chat",
        "SKILL.md",
      ),
      "utf8",
    );
    expect(sample).toContain("murph-public-group-skill-baseline");
  });

  it("replaces exactly the five installed baseline files from an explicit root", async () => {
    const repoRoot = await createTemporaryRoot();
    const bundleRoot = await createBundleWithBaselines(repoRoot);
    const sourceRoot = await createPrivateSkillsAt(
      path.join(repoRoot, "private-skills"),
    );

    await expect(installHostedGroupSkills({
      bundleRoot,
      env: {
        [HOSTED_GROUP_SKILLS_ROOT_ENV]: path.relative(repoRoot, sourceRoot),
      },
      repoRoot,
    })).resolves.toEqual({ skillCount: HOSTED_GROUP_SKILL_SLUGS.length });

    for (const slug of HOSTED_GROUP_SKILL_SLUGS) {
      const installed = await readFile(
        path.join(
          bundleRoot,
          "node_modules",
          "@murphai",
          "assistant-engine",
          "skills",
          slug,
          "SKILL.md",
        ),
        "utf8",
      );
      expect(installed).toContain(`private ${slug}`);
      expect(installed).not.toContain("murph-public-group-skill-baseline");
    }
  });

  it("discovers the private integration checkout layout", async () => {
    const workspaceRoot = await createTemporaryRoot();
    const repoRoot = path.join(workspaceRoot, "murph-public");
    await writeMurphCloudMarker(workspaceRoot);
    const bundleRoot = await createBundleWithBaselines(repoRoot);
    await createPrivateSkillsAt(
      path.join(
        workspaceRoot,
        "packages",
        "hosted-assistant-skills",
        "skills",
      ),
    );

    await expect(installHostedGroupSkills({
      bundleRoot,
      env: {},
      repoRoot,
    })).resolves.toEqual({ skillCount: HOSTED_GROUP_SKILL_SLUGS.length });
  });

  it("discovers the private Cloudflare deploy checkout layout", async () => {
    const repoRoot = await createTemporaryRoot();
    const bundleRoot = await createBundleWithBaselines(repoRoot);
    const privateRoot = path.join(repoRoot, "murph-cloud-private");
    await writeMurphCloudMarker(privateRoot);
    await createPrivateSkillsAt(
      path.join(
        privateRoot,
        "packages",
        "hosted-assistant-skills",
        "skills",
      ),
    );

    await expect(installHostedGroupSkills({
      bundleRoot,
      env: {},
      repoRoot,
    })).resolves.toEqual({ skillCount: HOSTED_GROUP_SKILL_SLUGS.length });
  });

  it("fails closed when a recognized Murph Cloud checkout lacks its private skills", async () => {
    const repoRoot = await createTemporaryRoot();
    const bundleRoot = await createBundleWithBaselines(repoRoot);
    await writeMurphCloudMarker(path.join(repoRoot, "murph-cloud-private"));

    await expect(installHostedGroupSkills({
      bundleRoot,
      env: {},
      repoRoot,
    })).rejects.toThrow("is missing hosted group skills");
  });

  it("fails closed for an incomplete or wider private source", async () => {
    const repoRoot = await createTemporaryRoot();
    const bundleRoot = await createBundleWithBaselines(repoRoot);
    const sourceRoot = await createPrivateSkillsAt(
      path.join(repoRoot, "private-skills"),
    );
    await mkdir(path.join(sourceRoot, "unexpected-skill"));

    await expect(installHostedGroupSkills({
      bundleRoot,
      env: { [HOSTED_GROUP_SKILLS_ROOT_ENV]: sourceRoot },
      repoRoot,
    })).rejects.toThrow("must contain exactly");
  });

  it("rejects a public baseline presented as private hosted behavior", async () => {
    const repoRoot = await createTemporaryRoot();
    const bundleRoot = await createBundleWithBaselines(repoRoot);
    const sourceRoot = await createPrivateSkillsAt(
      path.join(repoRoot, "private-skills"),
    );
    await writeSkill(
      sourceRoot,
      "group-chat",
      "<!-- murph-public-group-skill-baseline:v1 -->\nnot private",
    );

    await expect(installHostedGroupSkills({
      bundleRoot,
      env: { [HOSTED_GROUP_SKILLS_ROOT_ENV]: sourceRoot },
      repoRoot,
    })).rejects.toThrow("is a public baseline");
  });
});
