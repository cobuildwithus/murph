import { HABITAT_CATALOG } from "@murphai/contracts";

import type { CategoryNote } from "./category-notes";
import {
  ObjectSprite,
  resolveObjectVisualState,
  type ObjectVisualState,
} from "./category-visual-primitives";
import {
  isInstalled,
  type ResolvedCategory,
  type ResolvedObject,
} from "./home-model";

const RING_STYLES: Record<ObjectVisualState, string> = {
  known: "border border-secondary",
  met: "border-2 border-primary",
  unmet: "border-2 border-destructive",
  unknown: "border border-dashed border-primary",
  skipped: "border border-dashed border-muted-foreground",
};

type ShelfTile =
  | { kind: "object"; object: ResolvedObject }
  | { kind: "unknown"; label: string }
  | { kind: "overflow"; count: number };

const catalogIndicatorLabelByKey = new Map(
  HABITAT_CATALOG.aspects.flatMap((aspect) =>
    aspect.indicators.map(
      (indicator) => [`${aspect.id}:${indicator.id}`, indicator.label] as const,
    ),
  ),
);

function normalizeLabel(label: string): string {
  return label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function shelfTiles(
  category: ResolvedCategory,
  note: CategoryNote,
): ShelfTile[] {
  const objects = category.objects.filter((object) => !object.decor);
  const placedUnknownLabels = new Set(
    objects.flatMap((object) => {
      if (object.state !== "unknown") {
        return [];
      }
      const catalogLabel = catalogIndicatorLabelByKey.get(
        `${object.aspectId}:${object.indicatorId}`,
      );
      return [object.label, catalogLabel]
        .filter((label): label is string => label !== undefined)
        .map(normalizeLabel);
    }),
  );
  const tiles: ShelfTile[] = [
    ...objects.map((object): ShelfTile => ({ kind: "object", object })),
    ...note.unknownLabels
      .filter((label) => !placedUnknownLabels.has(normalizeLabel(label)))
      .map((label): ShelfTile => ({ kind: "unknown", label })),
  ];

  return tiles.length <= 8
    ? tiles
    : [...tiles.slice(0, 7), { kind: "overflow", count: tiles.length - 7 }];
}

function ShelfObjectSprite({
  object,
  absent,
}: {
  object: ResolvedObject;
  absent: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`size-13 shrink-0 sm:size-15 ${absent ? "opacity-40" : ""}`}
      aria-hidden="true"
    >
      {object.sprite ? (
        <ObjectSprite
          sprite={object.sprite}
          x={4}
          y={4}
          width={56}
          height={56}
        />
      ) : (
        <>
          <rect
            x={13}
            y={15}
            width={38}
            height={34}
            rx={7}
            fill="#fffcf6"
            stroke="#736a58"
            strokeWidth={1.5}
          />
          <circle cx={32} cy={32} r={4} fill="#7a8c6e" />
        </>
      )}
    </svg>
  );
}

function ObjectTile({ object }: { object: ResolvedObject }) {
  const state = resolveObjectVisualState(object);
  const absent = object.state === "known" && !isInstalled(object);
  const ringState = absent ? "skipped" : state;
  const showSprite = state !== "unknown" && state !== "skipped";
  return (
    <div className="flex min-h-32 w-full flex-col items-center gap-1.5 px-1 py-1">
      <span
        className={`relative flex size-18 shrink-0 items-center justify-center rounded-full bg-secondary/20 sm:size-20 ${RING_STYLES[ringState]}`}
        aria-hidden="true"
      >
        {showSprite ? (
          <ShelfObjectSprite object={object} absent={absent} />
        ) : null}
        {state === "unknown" ? (
          <span className="font-mono text-base font-semibold text-primary">
            ?
          </span>
        ) : null}
        {state === "skipped" || absent ? (
          <span
            className={`font-mono text-base text-muted-foreground ${
              absent ? "absolute right-1 top-0" : ""
            }`}
          >
            –
          </span>
        ) : null}
      </span>
      <span className="max-w-24 text-center text-xs font-medium leading-tight text-foreground">
        {object.label}
      </span>
      {object.state === "known" && object.valueText ? (
        <span className="max-w-24 text-center text-xs leading-tight text-muted-foreground">
          {object.valueText}
        </span>
      ) : null}
    </div>
  );
}

function EmptyTile({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 w-full flex-col items-center gap-1.5 px-1 py-1">
      <div className="flex size-18 items-center justify-center rounded-full border border-dashed border-primary bg-secondary/20 sm:size-20">
        <span className="font-mono text-base font-semibold text-primary">
          ?
        </span>
      </div>
      <p className="max-w-24 text-center text-xs font-medium leading-tight text-foreground">
        {label}
      </p>
    </div>
  );
}

function OverflowTile({ count }: { count: number }) {
  return (
    <div className="flex min-h-32 w-full flex-col items-center gap-1.5 px-1 py-1">
      <div className="flex size-18 items-center justify-center rounded-full border border-dashed border-muted-foreground bg-secondary/20 sm:size-20">
        <span className="font-mono text-sm font-semibold text-muted-foreground">
          +{count}
        </span>
      </div>
      <p className="text-center text-xs leading-tight text-muted-foreground">
        more items
      </p>
    </div>
  );
}

export function CategoryShelf({
  category,
  note,
}: {
  category: ResolvedCategory;
  note: CategoryNote;
}) {
  const tiles = shelfTiles(category, note);

  return (
    <section
      className="py-2"
      aria-label={`${category.title}: ${note.known} of ${note.total} facts known`}
    >
      <ul
        role="list"
        className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-3"
      >
        {tiles.map((tile) => (
          <li
            key={
              tile.kind === "object"
                ? tile.object.id
                : tile.kind === "unknown"
                ? `unknown-${tile.label}`
                : "overflow"
            }
            className="min-w-0"
          >
            {tile.kind === "object" ? (
              <ObjectTile object={tile.object} />
            ) : null}
            {tile.kind === "unknown" ? <EmptyTile label={tile.label} /> : null}
            {tile.kind === "overflow" ? (
              <OverflowTile count={tile.count} />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
