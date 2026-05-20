import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

test("getMurphGithubStarCount returns null after a short GitHub timeout", async () => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | undefined;
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetch);

  const { getMurphGithubStarCount } = await import("@/src/lib/github-stars");
  const result = getMurphGithubStarCount();

  await vi.advanceTimersByTimeAsync(2000);

  await expect(result).resolves.toBeNull();
  expect(requestSignal?.aborted).toBe(true);
});

test("getMurphGithubStarCount reads a valid GitHub stars response", async () => {
  const fetch = vi.fn(async () => new Response(
    JSON.stringify({ stargazers_count: 1234 }),
    {
      headers: { "content-type": "application/json" },
      status: 200,
    },
  ));
  vi.stubGlobal("fetch", fetch);

  const { getMurphGithubStarCount } = await import("@/src/lib/github-stars");

  await expect(getMurphGithubStarCount()).resolves.toBe(1234);
  expect(fetch).toHaveBeenCalledWith(
    "https://api.github.com/repos/cobuildwithus/murph",
    expect.objectContaining({
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      signal: expect.any(AbortSignal),
    }),
  );
});
