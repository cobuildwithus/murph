import type { SVGProps } from "react";

import { evaluateIndicatorTarget } from "./category-notes";
import type {
  ObjectSprite as ObjectSpriteDefinition,
  ResolvedObject,
} from "./home-model";

export type ObjectVisualState =
  | "known"
  | "met"
  | "unmet"
  | "unknown"
  | "skipped";

const OBJECT_STATE_LABELS: Record<ObjectVisualState, string> = {
  known: "known",
  met: "target met",
  unmet: "off target",
  unknown: "not yet known",
  skipped: "skipped",
};

export function resolveObjectVisualState(
  object: ResolvedObject,
): ObjectVisualState {
  if (object.state !== "known") {
    return object.state;
  }
  const verdict = evaluateIndicatorTarget(object.indicatorId, object.value);
  return verdict === null ? "known" : verdict ? "met" : "unmet";
}

export function objectTooltipText(
  object: ResolvedObject,
  state?: ObjectVisualState,
): string {
  const value = object.valueText ? `: ${object.valueText}` : "";
  const status = state ? ` (${OBJECT_STATE_LABELS[state]})` : "";
  return `${object.label}${value}${status}`;
}

export function ObjectSprite({
  sprite,
  ...imageProps
}: Omit<SVGProps<SVGImageElement>, "href"> & {
  sprite: ObjectSpriteDefinition;
}) {
  return (
    <image
      href={sprite.src}
      width={sprite.w}
      height={sprite.h}
      preserveAspectRatio="xMidYMid meet"
      {...imageProps}
    />
  );
}

export function StateBadge({
  x,
  y,
  state,
}: {
  x: number;
  y: number;
  state: "known" | "met" | "unmet";
}) {
  if (state === "known") {
    return (
      <circle
        cx={x}
        cy={y}
        r={4}
        fill="#736a58"
        stroke="#fffcf6"
        strokeWidth={1.5}
      />
    );
  }

  const met = state === "met";
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={7}
        fill={met ? "#5a6e32" : "#8b5d3f"}
        stroke="#fffcf6"
        strokeWidth={1.5}
      />
      <text
        x={x}
        y={y + 3.5}
        fill="#fffcf6"
        fontFamily="DM Sans, system-ui, sans-serif"
        fontSize={10}
        fontWeight={700}
        textAnchor="middle"
      >
        {met ? "✓" : "✗"}
      </text>
    </g>
  );
}
