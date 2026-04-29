const FINNISH_SAUNA_ROUTE_ID = "finnish-sauna";
const NORWEGIAN_4X4_ROUTE_ID = "norwegian-4x4";
const RED_LIGHT_GLASSES_ROUTE_ID = "red-light-glasses-before-bed";
const BRYAN_JOHNSON_SAUNA_ROUTE_ID = "bryan-johnson-blueprint";
const INTERMITTENT_FASTING_ROUTE_ID = "time-restricted-eating-18-6";

export const DEFAULT_PROTOCOL_IMAGE = "/design-assets/hero-04.png";

const PROTOCOL_ROUTE_IMAGES: Record<string, string> = {
  [BRYAN_JOHNSON_SAUNA_ROUTE_ID]: "/design-assets/hero-bryan-johnson-sauna.jpg",
  "cold-plunge": "/design-assets/cold-plunge-tub.jpeg",
  [FINNISH_SAUNA_ROUTE_ID]: "/design-assets/hero-finnish-sauna.jpeg",
  [INTERMITTENT_FASTING_ROUTE_ID]: "/design-assets/hero-intermittent-fasting.jpg",
  [NORWEGIAN_4X4_ROUTE_ID]: "/design-assets/hero-norwegian-4x4.jpeg",
  [RED_LIGHT_GLASSES_ROUTE_ID]: "/design-assets/hero-red-light-glasses-before-bed.jpeg",
};

export function resolveExperimentRouteImage(
  routeId: string,
  generatedImage: string | null | undefined,
): string {
  return PROTOCOL_ROUTE_IMAGES[routeId] ?? generatedImage ?? DEFAULT_PROTOCOL_IMAGE;
}
