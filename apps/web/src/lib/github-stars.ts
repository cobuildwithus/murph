const GITHUB_STARS_ENDPOINT =
  "https://api.github.com/repos/cobuildwithus/murph";
const GITHUB_STARS_TIMEOUT_MS = 1500;

export async function getMurphGithubStarCount(): Promise<number | null> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, GITHUB_STARS_TIMEOUT_MS);
  });
  const request = fetchMurphGithubStarCount(controller.signal);

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchMurphGithubStarCount(signal: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(GITHUB_STARS_ENDPOINT, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
  }
}

export function formatStarCount(count: number): string {
  if (count < 1000) return count.toString();
  const thousands = count / 1000;
  return `${thousands.toFixed(thousands < 10 ? 1 : 0).replace(/\.0$/, "")}k`;
}
