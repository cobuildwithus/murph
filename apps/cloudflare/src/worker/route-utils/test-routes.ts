import type {
  RouteMatcher,
} from "../routes.ts";

export function matchHostedLocalTestUserRoute(prefix: string, suffix: string): RouteMatcher {
  return (pathname) => {
    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
      return null;
    }

    const userId = pathname.slice(prefix.length, pathname.length - suffix.length);
    return userId.length > 0 ? { userId } : null;
  };
}
