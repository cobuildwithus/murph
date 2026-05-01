export const DEFAULT_PROTOCOL_IMAGE = "/design-assets/hero-04.png";

export function resolveExperimentRouteImage(
  _routeId: string,
  generatedImage: string | null | undefined,
): string {
  return generatedImage ?? DEFAULT_PROTOCOL_IMAGE;
}
