const CLOUDFLARE_CHALLENGE_HOST = "challenges.cloudflare.com";
const CLOUDFLARE_CHALLENGE_TITLE = /^just a moment(?:\.{3}|…)?$/iu;

export function isHostedLocalProviderChallengeSurface(input: {
  frameUrls: readonly string[];
  title: string;
}): boolean {
  if (CLOUDFLARE_CHALLENGE_TITLE.test(input.title.trim())) {
    return true;
  }

  return input.frameUrls.some((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:"
        && (
          url.hostname === CLOUDFLARE_CHALLENGE_HOST
          || url.hostname.endsWith(`.${CLOUDFLARE_CHALLENGE_HOST}`)
        );
    } catch {
      return false;
    }
  });
}
