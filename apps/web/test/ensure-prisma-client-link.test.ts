import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ensureHostedWebPrismaClientLink,
  resolveHostedWebPrismaClientLinkPaths,
} from "../scripts/ensure-prisma-client-link";

const HOSTED_WEB_DIR = path.resolve(import.meta.dirname, "..");

describe("ensure-prisma-client-link", () => {
  it("resolves the generated Prisma directory and app-local .prisma link path", () => {
    const paths = resolveHostedWebPrismaClientLinkPaths(HOSTED_WEB_DIR);

    expect(path.basename(paths.generatedPrismaDir)).toBe(".prisma");
    expect(paths.linkPath).toBe(path.join(HOSTED_WEB_DIR, "node_modules", ".prisma"));
  });

  it("creates or preserves the hosted-web .prisma symlink", async () => {
    await ensureHostedWebPrismaClientLink(HOSTED_WEB_DIR);

    const paths = resolveHostedWebPrismaClientLinkPaths(HOSTED_WEB_DIR);
    const relativeTarget = path.relative(path.dirname(paths.linkPath), paths.generatedPrismaDir) || ".";

    expect(await import("node:fs/promises").then((fs) => fs.readlink(paths.linkPath))).toBe(
      relativeTarget,
    );
  });
});
