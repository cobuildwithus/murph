import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesignProofUploadError,
  discoverRepoRoots,
  loadCloudflareImagesConfig,
  parseCliArgs,
  uploadDesignProofImage,
} from "./upload-design-proof-image.ts";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const PRIMARY_TOKEN = "primary-token";
const PROCESS_TOKEN = "process-token";
const PUBLIC_URL =
  "https://imagedelivery.net/account-hash/image-id/public";
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const tempDirectories: string[] = [];

async function makeTempDirectory(prefix: string): Promise<string> {
  const root = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!root) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const directory = await mkdtemp(path.join(root, prefix));
  tempDirectories.push(directory);
  return directory;
}

async function writePng(directory: string): Promise<string> {
  const filePath = path.join(directory, "proof.png");
  await writeFile(filePath, PNG_BYTES);
  return filePath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    ),
  );
});

describe("design-proof environment loading", () => {
  it("discovers the primary checkout from a linked worktree and reads its ignored env", async () => {
    const directory = await makeTempDirectory("design-proof-git-");
    const primary = path.join(directory, "primary");
    const linked = path.join(directory, "linked");
    await mkdir(primary);
    execFileSync("git", ["init", "-q"], { cwd: primary });
    await writeFile(path.join(primary, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: primary });
    execFileSync(
      "git",
      [
        "-c", "user.name=Redacted",
        "-c", "user.email=redacted@users.noreply.github.com",
        "commit", "-qm", "fixture",
      ],
      { cwd: primary },
    );
    await writeFile(
      path.join(primary, ".env"),
      [
        `CLOUDFLARE_IMAGES_ACCOUNT_ID=${ACCOUNT_ID}`,
        `CLOUDFLARE_IMAGES_API_KEY=${PRIMARY_TOKEN}`,
        "UNRELATED_SECRET=must-not-be-returned",
        "",
      ].join("\n"),
    );
    execFileSync(
      "git",
      ["worktree", "add", "-q", "-b", "linked-fixture", linked],
      { cwd: primary },
    );

    const roots = discoverRepoRoots(linked);
    expect(roots).toEqual({
      currentRepoRoot: await realpath(linked),
      primaryRepoRoot: await realpath(primary),
    });
    await expect(
      loadCloudflareImagesConfig({ cwd: linked, env: {} }),
    ).resolves.toEqual({
      accountId: ACCOUNT_ID,
      apiKey: PRIMARY_TOKEN,
    });
  });

  it("uses process values first and fills missing values in checkout order", async () => {
    const directory = await makeTempDirectory("design-proof-env-");
    const current = path.join(directory, "current");
    const primary = path.join(directory, "primary");
    await Promise.all([mkdir(current), mkdir(primary)]);
    await writeFile(
      path.join(current, ".env.local"),
      `CLOUDFLARE_IMAGES_API_KEY=current-token\n`,
    );
    await writeFile(
      path.join(primary, ".env"),
      [
        `CLOUDFLARE_IMAGES_ACCOUNT_ID=${ACCOUNT_ID}`,
        `CLOUDFLARE_IMAGES_API_KEY=${PRIMARY_TOKEN}`,
        "",
      ].join("\n"),
    );

    await expect(
      loadCloudflareImagesConfig({
        env: { CLOUDFLARE_IMAGES_API_KEY: PROCESS_TOKEN },
        repoRoots: {
          currentRepoRoot: current,
          primaryRepoRoot: primary,
        },
      }),
    ).resolves.toEqual({
      accountId: ACCOUNT_ID,
      apiKey: PROCESS_TOKEN,
    });
  });

  it("fails safely for missing or malformed configuration", async () => {
    const directory = await makeTempDirectory("design-proof-config-");
    await expect(
      loadCloudflareImagesConfig({
        env: {},
        repoRoots: {
          currentRepoRoot: directory,
          primaryRepoRoot: directory,
        },
      }),
    ).rejects.toThrow("CLOUDFLARE_IMAGES_ACCOUNT_ID");
    await expect(
      loadCloudflareImagesConfig({
        env: {
          CLOUDFLARE_IMAGES_ACCOUNT_ID: "not-an-account",
          CLOUDFLARE_IMAGES_API_KEY: "token",
        },
        repoRoots: {
          currentRepoRoot: directory,
          primaryRepoRoot: directory,
        },
      }),
    ).rejects.toThrow("not a valid account ID");
  });
});

describe("Cloudflare Images design-proof upload", () => {
  it("uploads with a neutral filename and verifies the public image", async () => {
    const directory = await makeTempDirectory("design-proof-upload-");
    const filePath = await writePng(directory);
    const fetchImpl = vi.fn(
      async (input: Request | URL | string, init?: RequestInit) => {
        if (fetchImpl.mock.calls.length === 1) {
          expect(String(input)).toBe(
            `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`,
          );
          expect(init?.method).toBe("POST");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            `Bearer ${PRIMARY_TOKEN}`,
          );
          const form = init?.body as FormData;
          expect(form.get("requireSignedURLs")).toBe("false");
          const image = form.get("file");
          expect(image).toBeInstanceOf(File);
          expect((image as File).name).toBe("design-proof-2.png");
          expect((image as File).type).toBe("image/png");
          return Response.json({
            success: true,
            result: { variants: [PUBLIC_URL] },
          });
        }

        expect(String(input)).toBe(PUBLIC_URL);
        expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("error");
        return new Response(PNG_BYTES, {
          headers: { "content-type": "image/png" },
        });
      },
    );

    await expect(
      uploadDesignProofImage({
        accountId: ACCOUNT_ID,
        apiKey: PRIMARY_TOKEN,
        fetchImpl,
        filePath,
        index: 2,
      }),
    ).resolves.toBe(PUBLIC_URL);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects symlinks and unsupported files before any network request", async () => {
    const directory = await makeTempDirectory("design-proof-input-");
    const imagePath = await writePng(directory);
    const linkPath = path.join(directory, "linked.png");
    const textPath = path.join(directory, "not-image.png");
    await symlink(imagePath, linkPath);
    await writeFile(textPath, "not an image");
    const fetchImpl = vi.fn();

    await expect(
      uploadDesignProofImage({
        accountId: ACCOUNT_ID,
        apiKey: PRIMARY_TOKEN,
        fetchImpl,
        filePath: linkPath,
      }),
    ).rejects.toThrow("regular file");
    await expect(
      uploadDesignProofImage({
        accountId: ACCOUNT_ID,
        apiKey: PRIMARY_TOKEN,
        fetchImpl,
        filePath: textPath,
      }),
    ).rejects.toThrow("not a supported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose upstream response details on rejection", async () => {
    const directory = await makeTempDirectory("design-proof-error-");
    const filePath = await writePng(directory);
    const fetchImpl = vi.fn(async () =>
      new Response(`provider echoed ${PRIMARY_TOKEN}`, { status: 403 })
    );

    let error: unknown;
    try {
      await uploadDesignProofImage({
        accountId: ACCOUNT_ID,
        apiKey: PRIMARY_TOKEN,
        fetchImpl,
        filePath,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DesignProofUploadError);
    expect((error as Error).message).toBe(
      "Cloudflare Images rejected the upload (HTTP 403).",
    );
    expect((error as Error).message).not.toContain(PRIMARY_TOKEN);
  });

  it("rejects untrusted variants and non-image verification responses", async () => {
    const directory = await makeTempDirectory("design-proof-variant-");
    const filePath = await writePng(directory);
    const untrustedFetch = vi.fn(async () =>
      Response.json({
        success: true,
        result: { variants: ["https://example.test/image/public"] },
      })
    );
    await expect(
      uploadDesignProofImage({
        accountId: ACCOUNT_ID,
        apiKey: PRIMARY_TOKEN,
        fetchImpl: untrustedFetch,
        filePath,
      }),
    ).rejects.toThrow("did not return a public delivery variant");

    const nonImageFetch = vi.fn(async () => {
      if (nonImageFetch.mock.calls.length === 1) {
        return Response.json({
          success: true,
          result: { variants: [PUBLIC_URL] },
        });
      }
      return new Response("not an image", {
        headers: { "content-type": "text/plain" },
      });
    });
    await expect(
      uploadDesignProofImage({
        accountId: ACCOUNT_ID,
        apiKey: PRIMARY_TOKEN,
        fetchImpl: nonImageFetch,
        filePath,
      }),
    ).rejects.toThrow("did not render as an image");
  });
});

describe("design-proof CLI arguments", () => {
  it("accepts multiple files and a positional-only separator", () => {
    expect(parseCliArgs(["one.png", "two.webp"])).toEqual({
      help: false,
      files: ["one.png", "two.webp"],
    });
    expect(parseCliArgs(["--", "-proof.png"])).toEqual({
      help: false,
      files: ["-proof.png"],
    });
  });

  it("returns help and rejects empty or unknown arguments", () => {
    expect(parseCliArgs(["--help"])).toEqual({ help: true, files: [] });
    expect(() => parseCliArgs([])).toThrow("at least one");
    expect(() => parseCliArgs(["--unknown"])).toThrow("Unknown option");
  });
});
