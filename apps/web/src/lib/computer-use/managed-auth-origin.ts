const KERNEL_MANAGED_AUTH_HOSTED_UI_HOSTNAME = "auth.onkernel.com";

export function isAllowedKernelManagedAuthHostedUrl(input: {
  url: string | URL;
}): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = typeof input.url === "string"
      ? new URL(input.url)
      : input.url;
  } catch {
    return false;
  }

  return parsedUrl.protocol === "https:"
    && parsedUrl.port === ""
    && parsedUrl.hostname === KERNEL_MANAGED_AUTH_HOSTED_UI_HOSTNAME;
}
