import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesignProofUploadError,
  discoverRepoRoots,
  loadCloudflareImagesConfig,
  main,
  parseCliArgs,
  uploadDesignProofImage,
} from "./upload-design-proof-image.ts";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const CURRENT_ACCOUNT_ID = "11111111111111111111111111111111";
const PRIMARY_ACCOUNT_ID = "22222222222222222222222222222222";
const PRIMARY_TOKEN = "primary-token";
const PROCESS_TOKEN = "process-token";
const PUBLIC_URL =
  "https://imagedelivery.net/account-hash/image-id/public";
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const WEBP_BYTES = Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary");
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

  it("removes Cloudflare Images settings from Git discovery subprocesses", async () => {
    const directory = await makeTempDirectory("design-proof-git-env-");
    const repo = path.join(directory, "repo");
    const bin = path.join(directory, "bin");
    const wrapperPath = path.join(bin, "git");
    const markerPath = path.join(directory, "git-environment.txt");
    await Promise.all([mkdir(repo), mkdir(bin)]);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const realGit = execFileSync("which", ["git"], {
      encoding: "utf8",
    }).trim();
    await writeFile(
      wrapperPath,
      [
        "#!/bin/sh",
        "if [ \"${CLOUDFLARE_IMAGES_API_KEY+x}\" = x ] || [ \"${CLOUDFLARE_IMAGES_ACCOUNT_ID+x}\" = x ]; then",
        "  printf 'present\\n' >> \"$MURPH_TEST_GIT_ENV_MARKER\"",
        "else",
        "  printf 'absent\\n' >> \"$MURPH_TEST_GIT_ENV_MARKER\"",
        "fi",
        "exec \"$MURPH_TEST_REAL_GIT\" \"$@\"",
        "",
      ].join("\n"),
    );
    await chmod(wrapperPath, 0o755);

    const previousPath = process.env.PATH;
    const previousAccountId = process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID;
    const previousApiKey = process.env.CLOUDFLARE_IMAGES_API_KEY;
    const previousRealGit = process.env.MURPH_TEST_REAL_GIT;
    const previousMarker = process.env.MURPH_TEST_GIT_ENV_MARKER;
    try {
      process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
      process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID = ACCOUNT_ID;
      process.env.CLOUDFLARE_IMAGES_API_KEY = PROCESS_TOKEN;
      process.env.MURPH_TEST_REAL_GIT = realGit;
      process.env.MURPH_TEST_GIT_ENV_MARKER = markerPath;

      expect(discoverRepoRoots(repo)).toEqual({
        currentRepoRoot: await realpath(repo),
        primaryRepoRoot: await realpath(repo),
      });
      expect((await readFile(markerPath, "utf8")).trim().split("\n")).toEqual([
        "absent",
        "absent",
        "absent",
      ]);
    } finally {
      restoreProcessEnv("PATH", previousPath);
      restoreProcessEnv(
        "CLOUDFLARE_IMAGES_ACCOUNT_ID",
        previousAccountId,
      );
      restoreProcessEnv("CLOUDFLARE_IMAGES_API_KEY", previousApiKey);
      restoreProcessEnv("MURPH_TEST_REAL_GIT", previousRealGit);
      restoreProcessEnv("MURPH_TEST_GIT_ENV_MARKER", previousMarker);
    }
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

  it("prefers invoking checkout files before primary checkout files", async () => {
    const directory = await makeTempDirectory("design-proof-order-");
    const current = path.join(directory, "current");
    const primary = path.join(directory, "primary");
    await Promise.all([mkdir(current), mkdir(primary)]);
    await writeFile(
      path.join(current, ".env.local"),
      "CLOUDFLARE_IMAGES_API_KEY=current-local-token\n",
    );
    await writeFile(
      path.join(current, ".env"),
      [
        `CLOUDFLARE_IMAGES_ACCOUNT_ID=${CURRENT_ACCOUNT_ID}`,
        "CLOUDFLARE_IMAGES_API_KEY=current-env-token",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(primary, ".env.local"),
      [
        `CLOUDFLARE_IMAGES_ACCOUNT_ID=${PRIMARY_ACCOUNT_ID}`,
        `CLOUDFLARE_IMAGES_API_KEY=${PRIMARY_TOKEN}`,
        "",
      ].join("\n"),
    );

    await expect(
      loadCloudflareImagesConfig({
        env: {},
        repoRoots: {
          currentRepoRoot: current,
          primaryRepoRoot: primary,
        },
      }),
    ).resolves.toEqual({
      accountId: CURRENT_ACCOUNT_ID,
      apiKey: "current-local-token",
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

  it.each([
    ["JPEG", JPEG_BYTES, "image/jpeg", "jpg"],
    ["WebP", WEBP_BYTES, "image/webp", "webp"],
  ])("accepts %s signatures with canonical upload metadata", async (
    _label,
    bytes,
    contentType,
    extension,
  ) => {
    const directory = await makeTempDirectory("design-proof-format-");
    const filePath = path.join(directory, "proof.bin");
    await writeFile(filePath, bytes);
    const fetchImpl = vi.fn(
      async (_input: Request | URL | string, init?: RequestInit) => {
        if (fetchImpl.mock.calls.length === 1) {
          const image = (init?.body as FormData).get("file");
          expect(image).toBeInstanceOf(File);
          expect((image as File).name).toBe(`design-proof-1.${extension}`);
          expect((image as File).type).toBe(contentType);
          return Response.json({
            success: true,
            result: { variants: [PUBLIC_URL] },
          });
        }
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
      }),
    ).resolves.toBe(PUBLIC_URL);
  });

  it("rejects files above the Cloudflare Images input limit", async () => {
    const directory = await makeTempDirectory("design-proof-size-");
    const filePath = path.join(directory, "too-large.png");
    await writeFile(filePath, PNG_BYTES);
    await truncate(filePath, 10 * 1024 * 1024 + 1);
    const fetchImpl = vi.fn();

    await expect(
      uploadDesignProofImage({
        accountId: ACCOUNT_ID,
        apiKey: PRIMARY_TOKEN,
        fetchImpl,
        filePath,
      }),
    ).rejects.toThrow("exceeds the 10485760 byte limit");
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

describe("design-proof CLI execution", () => {
  it("prints each verified URL before starting the next upload", async () => {
    const directory = await makeTempDirectory("design-proof-main-");
    const repo = path.join(directory, "repo");
    await mkdir(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const desktopPath = path.join(repo, "desktop.png");
    const mobilePath = path.join(repo, "mobile.webp");
    await Promise.all([
      writeFile(desktopPath, PNG_BYTES),
      writeFile(mobilePath, WEBP_BYTES),
    ]);

    const events: string[] = [];
    let uploadCount = 0;
    const fetchImpl = vi.fn(
      async (input: Request | URL | string, init?: RequestInit) => {
        if (init?.method === "POST") {
          uploadCount += 1;
          const image = (init.body as FormData).get("file") as File;
          events.push(`upload:${image.name}:${image.type}`);
          if (uploadCount === 1) {
            return Response.json({
              success: true,
              result: { variants: [PUBLIC_URL] },
            });
          }
          return new Response("provider detail must stay hidden", { status: 503 });
        }
        events.push(`verify:${String(input)}`);
        return new Response(PNG_BYTES, {
          headers: { "content-type": "image/png" },
        });
      },
    );
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      events.push(`stdout:${String(chunk).trim()}`);
      return true;
    });
    const previousCwd = process.cwd();
    const previousAccountId = process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID;
    const previousApiKey = process.env.CLOUDFLARE_IMAGES_API_KEY;

    try {
      process.chdir(repo);
      process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID = ACCOUNT_ID;
      process.env.CLOUDFLARE_IMAGES_API_KEY = PRIMARY_TOKEN;
      vi.stubGlobal("fetch", fetchImpl);

      await expect(main([desktopPath, mobilePath])).rejects.toThrow(
        "Cloudflare Images rejected the upload (HTTP 503).",
      );
      expect(events).toEqual([
        "upload:design-proof-1.png:image/png",
        `verify:${PUBLIC_URL}`,
        `stdout:${PUBLIC_URL}`,
        "upload:design-proof-2.webp:image/webp",
      ]);
      expect(stdout).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(previousCwd);
      if (previousAccountId === undefined) {
        delete process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID;
      } else {
        process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID = previousAccountId;
      }
      if (previousApiKey === undefined) {
        delete process.env.CLOUDFLARE_IMAGES_API_KEY;
      } else {
        process.env.CLOUDFLARE_IMAGES_API_KEY = previousApiKey;
      }
      vi.unstubAllGlobals();
    }
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

function restoreProcessEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
