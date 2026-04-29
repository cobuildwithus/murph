import { healthCommonsCatalogSchema } from "@murphai/contracts";
import healthCommonsCatalogJson from "@murphai/health-commons/generated/catalog.json";
import {
  createHealthCommonsCatalogReader,
  type HealthCommonsCatalogReader,
  type HealthCommonsEntity,
} from "@murphai/health-commons/runtime";

export type { HealthCommonsCatalogReader, HealthCommonsEntity };

export const healthCommonsCatalog = createHealthCommonsCatalogReader(
  healthCommonsCatalogSchema.parse(healthCommonsCatalogJson),
);

export { createHealthCommonsCatalogReader };
