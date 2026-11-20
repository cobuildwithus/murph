/**
 * An iPhone, iPad or iPod, going by the request's user agent: the devices the
 * Murph app runs on. An iPad that asks for the desktop site says "Macintosh"
 * and still carries "Mobile/", so it counts. Everything else, a Mac included,
 * is a computer that gets a code to scan.
 */
export function isAppleMobileUserAgent(userAgent: string | null | undefined): boolean {
  const value = userAgent ?? "";
  return /iPhone|iPad|iPod/i.test(value)
    || (/Macintosh/i.test(value) && /Mobile\//i.test(value));
}

/**
 * A phone or tablet the app doesn't run on, Android mostly. A code to scan
 * would be on the phone itself, so it gets words instead.
 */
export function isOtherMobileUserAgent(userAgent: string | null | undefined): boolean {
  const value = userAgent ?? "";
  return !isAppleMobileUserAgent(value) && /Android|Mobile/i.test(value);
}
