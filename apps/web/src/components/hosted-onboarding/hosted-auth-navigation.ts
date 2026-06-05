"use client";

export function navigateHostedAuthRedirect(url: string): void {
  const targetUrl = resolveBrowserUrl(url);
  if (targetUrl && isSameBrowserDocument(targetUrl)) {
    reloadHostedAuthDocument(targetUrl);
    return;
  }

  window.location.assign(url);
}

function resolveBrowserUrl(url: string): URL | null {
  try {
    return new URL(url, window.location.href);
  } catch {
    return null;
  }
}

function isSameBrowserDocument(url: URL): boolean {
  return (
    url.origin === window.location.origin
    && url.pathname === window.location.pathname
    && url.search === window.location.search
  );
}

function reloadHostedAuthDocument(url: URL): void {
  try {
    window.history.replaceState(window.history.state, "", url.href);
  } catch {
    // Reloading the current document is still the important auth handoff.
  }

  if (typeof window.location.reload === "function") {
    window.location.reload();
    return;
  }

  window.location.assign(url.href);
}
