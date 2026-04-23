export const HOSTED_AUTHENTICATION_INTENTS = ["signup", "signin"] as const;

export type HostedAuthenticationIntent =
  (typeof HOSTED_AUTHENTICATION_INTENTS)[number];

export function isHostedAuthenticationIntent(
  value: unknown,
): value is HostedAuthenticationIntent {
  return (
    typeof value === "string"
    && HOSTED_AUTHENTICATION_INTENTS.includes(
      value as HostedAuthenticationIntent,
    )
  );
}
