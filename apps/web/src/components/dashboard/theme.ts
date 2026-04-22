/**
 * Shared between the desktop sidebar and the mobile dashboard header so
 * both surfaces drift together if the brand palette changes. Lives in a
 * server-safe module so both a client sidebar and a server shell can
 * import the same string without hitting the "use client" boundary,
 * which would turn the value into a client reference at build time.
 */
export const SIDEBAR_BRAND_GRADIENT =
  "bg-linear-to-b from-[#2d3436] via-[#3a2e24] to-[#2a1f16]";
