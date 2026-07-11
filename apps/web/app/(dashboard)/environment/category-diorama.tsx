import type { CategoryNote } from "./category-notes";
import {
  isInstalled,
  type ResolvedCategory,
  type ResolvedObject,
} from "./home-model";
import {
  ObjectSprite,
  objectTooltipText,
  resolveObjectVisualState,
  StateBadge,
  type ObjectVisualState,
} from "./category-visual-primitives";

const TW = 40;
const TH = 20;
const SLAB = 10;
const WALL_H = 54;

const FLOOR_TOPS: Record<string, string> = {
  sleep: "#f5eddc",
  workspace: "#f0e6cf",
  home: "#f2e7d0",
};

function project(gx: number, gy: number, z = 0): { x: number; y: number } {
  return { x: (gx - gy) * TW, y: (gx + gy) * TH - z };
}

function point(gx: number, gy: number, z = 0): string {
  const projected = project(gx, gy, z);
  return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
}

function Sprite({
  object,
  gx,
  gy,
  z,
}: {
  object: ResolvedObject;
  gx: number;
  gy: number;
  z: number;
}) {
  const sprite = object.sprite;
  if (!sprite) {
    return null;
  }

  if (object.mount) {
    const p = project(gx, gy, object.mount.z);
    const shear = object.mount.side === "n" ? 0.5 : -0.5;
    return (
      <g transform={`matrix(1, ${shear}, 0, 1, ${p.x}, ${p.y})`}>
        <rect
          x={-sprite.w / 2 + 2}
          y={-sprite.h + 1}
          width={sprite.w}
          height={sprite.h}
          rx={2}
          fill="rgba(45,52,54,0.10)"
        />
        <ObjectSprite
          sprite={sprite}
          width={sprite.w}
          height={sprite.h}
          x={-sprite.w / 2}
          y={-sprite.h}
        />
      </g>
    );
  }

  const p = project(gx, gy, z);
  return (
    <ObjectSprite
      sprite={sprite}
      width={sprite.w}
      height={sprite.h}
      x={p.x - sprite.w / 2}
      y={p.y - sprite.h * (sprite.anchorY ?? 0.82)}
    />
  );
}

function footprintPoints(gx: number, gy: number, size: number): string {
  return [
    point(gx - size, gy - size),
    point(gx + size, gy - size),
    point(gx + size, gy + size),
    point(gx - size, gy + size),
  ].join(" ");
}

function Footprint({
  object,
  gx,
  gy,
}: {
  object: ResolvedObject;
  gx: number;
  gy: number;
}) {
  const p = project(gx, gy);
  const stroke =
    object.state === "unknown"
      ? "#5a6e32"
      : object.state === "skipped"
      ? "#8b7c61"
      : "#736a58";

  return (
    <g>
      <polygon
        points={footprintPoints(
          gx,
          gy,
          object.state === "unknown" ? 0.8 : 0.68,
        )}
        fill={object.state === "known" ? "rgba(255,252,246,0.35)" : "none"}
        stroke={stroke}
        strokeWidth={1.4}
        strokeDasharray="4 4"
      />
      {object.state === "unknown" ? (
        <>
          <circle
            cx={p.x}
            cy={p.y}
            r={9}
            fill="#fffcf6"
            stroke={stroke}
            strokeWidth={1.4}
          />
          <text
            x={p.x}
            y={p.y + 4}
            fill={stroke}
            fontFamily="DM Mono, ui-monospace, monospace"
            fontSize={12}
            fontWeight={600}
            textAnchor="middle"
          >
            ?
          </text>
        </>
      ) : object.state === "skipped" ? (
        <line
          x1={p.x - 5}
          y1={p.y}
          x2={p.x + 5}
          y2={p.y}
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ) : null}
    </g>
  );
}

function Tooltip({
  object,
  state,
}: {
  object: ResolvedObject;
  state?: ObjectVisualState;
}) {
  return <title>{objectTooltipText(object, state)}</title>;
}

function objectPosition(object: ResolvedObject): {
  gx: number;
  gy: number;
  z: number;
} {
  return {
    gx: object.mount?.side === "w" ? 0 : object.lx,
    gy: object.mount?.side === "n" ? 0 : object.ly,
    z: object.z ?? object.mount?.z ?? 0,
  };
}

function objectMarkerPoint(
  object: ResolvedObject,
  gx: number,
  gy: number,
  z: number,
): { x: number; y: number } {
  const sprite = object.sprite;
  if (!sprite) {
    const p = project(gx, gy, z + 38);
    return { x: p.x + 18, y: p.y };
  }

  const p = project(gx, gy, object.mount ? object.mount.z : z);
  return {
    x: p.x + sprite.w / 2 - 3,
    y: p.y - sprite.h * (object.mount ? 1 : sprite.anchorY ?? 0.82) + 5,
  };
}

function DioramaObject({ object }: { object: ResolvedObject }) {
  const { gx, gy, z } = objectPosition(object);
  if (object.decor) {
    return (
      <g>
        <Tooltip object={object} />
        <Sprite object={object} gx={gx} gy={gy} z={z} />
      </g>
    );
  }

  const installed = isInstalled(object);
  const state = resolveObjectVisualState(object);
  if (!installed) {
    const p = project(gx, gy);
    return (
      <g>
        <Tooltip object={object} state={state} />
        <Footprint object={object} gx={gx} gy={gy} />
        {object.state === "known" &&
        (state === "known" || state === "met" || state === "unmet") ? (
          <StateBadge x={p.x + 24} y={p.y - 13} state={state} />
        ) : null}
      </g>
    );
  }

  const marker = objectMarkerPoint(object, gx, gy, z);
  return (
    <g>
      <Tooltip object={object} state={state} />
      <Sprite object={object} gx={gx} gy={gy} z={z} />
      {state === "known" || state === "met" || state === "unmet" ? (
        <StateBadge x={marker.x} y={marker.y} state={state} />
      ) : null}
    </g>
  );
}

function StageFloor({ category }: { category: ResolvedCategory }) {
  const top = [
    point(0, 0),
    point(category.w, 0),
    point(category.w, category.d),
    point(0, category.d),
  ].join(" ");
  const right = [
    point(category.w, 0),
    point(category.w, category.d),
    point(category.w, category.d, -SLAB),
    point(category.w, 0, -SLAB),
  ].join(" ");
  const left = [
    point(category.w, category.d),
    point(0, category.d),
    point(0, category.d, -SLAB),
    point(category.w, category.d, -SLAB),
  ].join(" ");

  return (
    <>
      <polygon points={left} fill="#c6b895" />
      <polygon points={right} fill="#d8ccb0" />
      <polygon
        points={top}
        fill={FLOOR_TOPS[category.id] ?? "#f3ecdd"}
        stroke="rgba(45,52,54,0.16)"
        strokeWidth={0.75}
      />
    </>
  );
}

function StageWalls({ category }: { category: ResolvedCategory }) {
  const northFace = [
    point(0, 0, WALL_H),
    point(category.w, 0, WALL_H),
    point(category.w, 0),
    point(0, 0),
  ].join(" ");
  const westFace = [
    point(0, 0, WALL_H),
    point(0, category.d, WALL_H),
    point(0, category.d),
    point(0, 0),
  ].join(" ");

  return (
    <>
      <polygon
        points={northFace}
        fill="#eee3cc"
        stroke="rgba(45,52,54,0.16)"
        strokeWidth={0.75}
      />
      <polygon
        points={westFace}
        fill="#e2d6ba"
        stroke="rgba(45,52,54,0.16)"
        strokeWidth={0.75}
      />
    </>
  );
}

function viewBox(category: ResolvedCategory): string {
  let minX = -category.d * TW;
  let maxX = category.w * TW;
  let minY = -WALL_H - 20;
  const maxY = (category.w + category.d) * TH + 30;

  for (const object of category.objects) {
    const { gx, gy, z } = objectPosition(object);
    const p = project(gx, gy, z);
    const width = object.sprite?.w ?? 52;
    const height = object.sprite?.h ?? 72;
    minX = Math.min(minX, p.x - width / 2 - 12);
    maxX = Math.max(maxX, p.x + width / 2 + 12);
    minY = Math.min(minY, p.y - height - 18);
  }

  return `${minX - 24} ${minY - 18} ${maxX - minX + 48} ${maxY - minY + 18}`;
}

export function CategoryDiorama({
  category,
  note,
}: {
  category: ResolvedCategory;
  note: CategoryNote;
}) {
  const detailsId = `category-${category.id}-object-details`;
  const objects = [...category.objects].sort((a, b) => {
    const aPosition = objectPosition(a);
    const bPosition = objectPosition(b);
    return aPosition.gx + aPosition.gy - (bPosition.gx + bPosition.gy);
  });

  return (
    <>
      <svg
        viewBox={viewBox(category)}
        className="h-64 w-full select-none sm:h-72 lg:h-96"
        role="img"
        aria-label={`${category.title}: ${note.known} of ${note.total} facts known`}
        aria-describedby={detailsId}
      >
        <StageFloor category={category} />
        <StageWalls category={category} />
        {objects.map((object) => (
          <DioramaObject key={object.id} object={object} />
        ))}
      </svg>
      <ul id={detailsId} className="sr-only">
        {category.objects.map((object) => (
          <li key={object.id}>
            {objectTooltipText(
              object,
              object.decor ? undefined : resolveObjectVisualState(object),
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
