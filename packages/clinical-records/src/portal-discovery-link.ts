export const medicalRecordsFindUrl = "https://www.withmurph.ai/connect/medical-records";
export const forwardedPortalFallback = `Possible portal account. Search for your hospital or clinic in Medical records: ${medicalRecordsFindUrl}`;

export function portalDiscoveryFragment(place: { id: string; brandName: string }): string {
  // Find accepts 120 characters. Both values come from the public directory.
  const params = new URLSearchParams({ find: place.brandName.slice(0, 120).replace(/[\uD800-\uDBFF]$/u, ""), provider: place.id });
  return `#${params}`;
}

export function normalizePortalDiscoveryFragment(hash: string): string {
  if (!hash.startsWith("#") || hash.length > 1800) return "";
  const params = new URLSearchParams(hash.slice(1));
  const id = params.get("provider") ?? "";
  const brandName = params.get("find") ?? "";
  if (params.size !== 2 || id.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)
    || !brandName.trim() || brandName.length > 120 || /[\u0000-\u001f\u007f]/u.test(brandName)) return "";
  return portalDiscoveryFragment({ id, brandName });
}

export function portalDiscoverySummary(place: { id: string; brandName: string }) {
  const fragment = portalDiscoveryFragment(place);
  const name = new URLSearchParams(fragment.slice(1)).get("find");
  return `Possible portal account at ${name}. Open Medical records to choose whether to connect: ${medicalRecordsFindUrl}${fragment}`;
}

export function portalDiscoveryAssistantInput(suggestion: string): string {
  return `The member used email to search the Medical records directory. Murph generated the public Find link below from the directory. Reply with the search result as written, including its label and full URL.\n\n${suggestion}`;
}

// Private ingress writes a UTF-8 plain-text replacement with a CRLF header separator.
export function readPortalDiscoverySuggestion(bytes: Uint8Array | null): string {
  if (!bytes) return forwardedPortalFallback;
  const message = new TextDecoder().decode(bytes);
  const separator = message.indexOf("\r\n\r\n");
  if (separator < 0) return forwardedPortalFallback;
  const suggestion = message.slice(separator + 4).trim();
  const fragment = normalizePortalDiscoveryFragment(suggestion.split(medicalRecordsFindUrl)[1] ?? "");
  if (!fragment) return forwardedPortalFallback;
  const params = new URLSearchParams(fragment.slice(1));
  const canonical = portalDiscoverySummary({ id: params.get("provider")!, brandName: params.get("find")! });
  return canonical === suggestion ? canonical : forwardedPortalFallback;
}
