import type { GroupJoinPermissionDisplay } from "./group-join-client";

/**
 * A join-page consent card. Most cards map one-to-one to a projection scope, but the
 * four gram-macro nutrition scopes are presented as a single "Daily macros" card so the
 * page shows two nutrition choices ("Daily macros" and "Daily calories") instead of five.
 * The grouping is presentation only: `scopeKeys` still carries the individual scope keys,
 * so the grant, delivery, read, and revocation model stay per-nutrient.
 */
export interface GroupJoinPermissionGroup {
  description: string;
  key: string;
  label: string;
  scopeKeys: string[];
}

const MACROS_GROUP_KEY = "group:daily-macros";

// The gram-based meal-nutrition scopes shown together as "Daily macros". Calories are
// deliberately excluded so they remain their own "Daily calories" card.
const MACRO_NOUN_BY_PROJECTION_KIND: Record<string, string> = {
  "protein-days.v0": "protein",
  "carbs-days.v0": "carbs",
  "fat-days.v0": "fat",
  "fiber-days.v0": "fiber",
};

function formatNutrientList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function isMacroPermission(permission: GroupJoinPermissionDisplay): boolean {
  return (
    MACRO_NOUN_BY_PROJECTION_KIND[permission.projectionScope.projectionKind] !== undefined
  );
}

/**
 * Collapse the gram-macro nutrition permissions into a single "Daily macros" group,
 * preserving the original order (the group takes the position of the first macro) and
 * leaving every other permission as its own single-scope group.
 */
export function groupJoinPermissionsForDisplay(
  permissions: readonly GroupJoinPermissionDisplay[],
): GroupJoinPermissionGroup[] {
  const macroPermissions = permissions.filter(isMacroPermission);
  const groups: GroupJoinPermissionGroup[] = [];
  let macrosInserted = false;

  for (const permission of permissions) {
    if (isMacroPermission(permission)) {
      if (macrosInserted) continue;
      macrosInserted = true;
      const nutrientList = formatNutrientList(
        macroPermissions.map(
          (macro) => MACRO_NOUN_BY_PROJECTION_KIND[macro.projectionScope.projectionKind]!,
        ),
      );
      groups.push({
        description:
          `Shares your last 7 days of daily ${nutrientList} totals from meals in Murph, including meals imported from connected apps.`,
        key: MACROS_GROUP_KEY,
        label: "Daily macros",
        scopeKeys: macroPermissions.map((macro) => macro.projectionScopeKey),
      });
      continue;
    }

    groups.push({
      description: permission.description,
      key: permission.projectionScopeKey,
      label: permission.label,
      scopeKeys: [permission.projectionScopeKey],
    });
  }

  return groups;
}
