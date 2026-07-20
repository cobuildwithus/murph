import type { PublicProductDetail } from "@murphai/contracts";
import Link from "next/link";

type Ingredient = PublicProductDetail["ingredients"]["active"][number];
type NutritionRow = PublicProductDetail["nutrition"]["rows"][number];
type ProductTestObservation = PublicProductDetail["productTests"]["observations"][number];

export function MurphSafeProductDetail(input: { product: PublicProductDetail }) {
  const { product } = input;
  const correctionHref = createCorrectionHref(product.productRef);
  const sourceUrl = toHttpUrl(product.source.url);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/search"
        prefetch={false}
        className="inline-flex min-h-11 items-center rounded-md font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        BACK TO SEARCH
      </Link>

      <header className="mt-8 border-b border-border pb-10 sm:pb-12">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
            {product.kind.toUpperCase()}
          </p>
          {product.marketStatus === "off_market" ? (
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
              No longer marketed
            </span>
          ) : null}
        </div>
        <h1 className="mt-4 max-w-4xl break-words font-serif text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-5xl lg:text-6xl">
          {product.name}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {product.brand ?? "Brand not reported"}
        </p>

        <dl className="mt-8 grid gap-5 border-t border-border pt-6 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <IdentityFact label="Serving" value={formatServing(product.serving)} />
          <IdentityFact label="UPC" value={product.upc ?? "Not reported"} />
          <IdentityFact label="Label source" value={product.source.name} />
        </dl>

        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              referrerPolicy="no-referrer"
              className="inline-flex min-h-11 items-center rounded-md text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Open source label
            </a>
          ) : null}
          <a
            href={`/api/public/v1/products/${encodeURIComponent(product.productRef)}`}
            referrerPolicy="no-referrer"
            className="inline-flex min-h-11 items-center rounded-md text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            View JSON
          </a>
        </div>
      </header>

      <ProductTestsSection product={product} />
      <IngredientsSection product={product} />
      <NutritionSection product={product} />
      <UnknownsSection product={product} />
      <ProvenanceSection product={product} />

      <section aria-labelledby="correction-heading" className="border-t border-border py-12 sm:py-16">
        <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
          CORRECTIONS
        </p>
        <h2 id="correction-heading" className="mt-3 font-serif text-3xl font-semibold tracking-[-0.025em] text-foreground">
          Think this record is wrong or out of date?
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Email support@withmurph.ai with the product name and a source we can
          review.
        </p>
        <a
          href={correctionHref}
          className="mt-5 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Report a correction
        </a>
      </section>
    </main>
  );
}

function ProductTestsSection(input: { product: PublicProductDetail }) {
  const { productTests } = input.product;

  return (
    <section aria-labelledby="product-tests-heading" className="border-b border-border py-12 sm:py-16">
      <SectionHeading
        eyebrow="PRODUCT TESTS"
        heading="Product tests"
        id="product-tests-heading"
      />
      <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
        Results reflect the tested sample and date. They may not represent every
        lot, package, or current formulation.
      </p>

      {productTests.status === "no_known_product_tests" ? (
        <div className="mt-8 max-w-3xl border-l border-border pl-5">
          <h3 className="font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
            No exact-linked product tests found
          </h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Murph has no product-level test tied to this exact record. This is
            an evidence gap, not a safety finding.
          </p>
        </div>
      ) : (
        <div className="mt-9">
          <p className="font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {productTests.total} linked {productTests.total === 1 ? "observation" : "observations"}
          </p>
          {productTests.truncated ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Showing {productTests.returned} of {productTests.total} observations
            </p>
          ) : null}

          <div className="mt-9 border-t border-border">
            {productTests.observations.map((observation) => (
              <ProductTestObservationRow
                key={observation.id}
                observation={observation}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ProductTestObservationRow(input: { observation: ProductTestObservation }) {
  const { observation } = input;
  const sourceUrl = toHttpUrl(observation.source.url);

  return (
    <article className="grid gap-6 border-b border-border py-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(16rem,0.45fr)]">
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground">
          {observation.source.name.toUpperCase()}
        </p>
        <h3 className="mt-2 break-words font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
          {observation.analyte.name}
        </h3>
        <p className="mt-3 text-lg text-foreground">
          {formatTestResult(observation.result)}
        </p>
        <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
          Basis: {formatEvidenceBasis(observation.result.basis)}
        </p>
        {observation.normalizedResult && hasDistinctNormalizedResult(observation) ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Normalized result: {formatNormalizedTestResult(observation)}. Basis: {formatEvidenceBasis(observation.normalizedResult.basis)}
          </p>
        ) : null}
        {observation.screening ? (
          <ObservationScreening screening={observation.screening} />
        ) : null}
      </div>

      <dl className="grid content-start gap-3 text-sm">
        <DefinitionFact label="Product match" value={formatMatchMethod(observation.testedProduct.matchMethod)} />
        <DefinitionFact label="Report" value={observation.source.reportTitle ?? "Not reported"} />
        <DefinitionFact label="Report date" value={observation.source.reportDate ?? "Not reported"} />
        <DefinitionFact label="Laboratory" value={observation.labName ?? "Not reported"} />
        <DefinitionFact label="Test method" value={observation.testMethod ?? "Not reported"} />
        {sourceUrl ? (
          <div className="grid gap-1">
            <dt className="font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground">
              SOURCE REPORT
            </dt>
            <dd>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
                className="inline-flex min-h-11 items-center break-all text-foreground underline decoration-border underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open report
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function ObservationScreening(input: {
  screening: NonNullable<ProductTestObservation["screening"]>;
}) {
  const { screening } = input;
  const thresholdUrl = toHttpUrl(screening.threshold.url);
  const exceeds = screening.comparison === "exceeds";

  return (
    <div className="mt-5 border-l border-border pl-4">
      <p className={`text-sm font-medium leading-6 ${exceeds ? "text-destructive" : "text-foreground"}`}>
        {exceeds
          ? "Above this screening threshold"
          : "Did not exceed this screening threshold"}
      </p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <DefinitionFact
          label="Threshold"
          value={`${formatNumber(screening.threshold.value)} ${screening.threshold.unit}. Basis: ${formatEvidenceBasis(screening.threshold.basis)}`}
        />
        <DefinitionFact
          label="Authority"
          value={screening.threshold.authority}
        />
        {screening.screeningPolicy ? (
          <DefinitionFact
            label="Screening policy"
            value={`Assumes ${formatNumber(screening.screeningPolicy.assumedBodyWeightKg)} kg body weight and ${formatNumber(screening.screeningPolicy.assumedServingsPerDay)} ${screening.screeningPolicy.assumedServingsPerDay === 1 ? "serving" : "servings"} per day`}
          />
        ) : null}
        {thresholdUrl ? (
          <div className="grid gap-1">
            <dt className="font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground">
              THRESHOLD SOURCE
            </dt>
            <dd>
              <a
                href={thresholdUrl}
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
                className="inline-flex min-h-11 items-center break-words text-foreground underline decoration-border underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {screening.threshold.name}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        This comparison is a screening reference, not a product safety determination.
      </p>
    </div>
  );
}

function IngredientsSection(input: { product: PublicProductDetail }) {
  const { product } = input;
  const hasStructuredIngredients =
    product.ingredients.active.length > 0 || product.ingredients.other.length > 0;

  return (
    <section aria-labelledby="ingredients-heading" className="border-b border-border py-12 sm:py-16">
      <SectionHeading
        eyebrow="LABEL CONTENTS"
        heading={product.kind === "supplement" ? "Supplement facts" : "Ingredients"}
        id="ingredients-heading"
      />

      {product.ingredients.statement ? (
        <SourceStatement label="Source statement" value={product.ingredients.statement} />
      ) : null}

      {product.ingredients.otherStatement ? (
        <SourceStatement
          label="Other ingredients"
          value={product.ingredients.otherStatement}
        />
      ) : null}

      {hasStructuredIngredients ? (
        <div className="mt-9 grid gap-10">
          {product.ingredients.active.length > 0 ? (
            <IngredientTable heading="Active ingredients" ingredients={product.ingredients.active} />
          ) : null}
          {product.ingredients.other.length > 0 ? (
            <IngredientTable heading="Other ingredients" ingredients={product.ingredients.other} />
          ) : null}
        </div>
      ) : product.ingredients.statement || product.ingredients.otherStatement ? null : (
        <p className="mt-7 text-sm leading-6 text-muted-foreground sm:text-base">
          Not reported by this source.
        </p>
      )}
    </section>
  );
}

function SourceStatement(input: { label: string; value: string }) {
  return (
    <div className="mt-7 max-w-4xl">
      <p className="font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground">
        {input.label.toUpperCase()}
      </p>
      <p className="mt-3 break-words text-sm leading-7 text-foreground sm:text-base">
        {input.value}
      </p>
    </div>
  );
}

function IngredientTable(input: { heading: string; ingredients: Ingredient[] }) {
  return (
    <div>
      <h3 className="font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {input.heading}
      </h3>
      <div className="mt-4 overflow-hidden border-t border-border">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-border font-mono text-[9px] tracking-[0.1em] text-muted-foreground sm:text-[10px]">
              <th className="w-[50%] py-3 pr-3 font-medium">INGREDIENT</th>
              <th className="w-[30%] px-2 py-3 font-medium">AMOUNT</th>
              <th className="w-[20%] py-3 pl-2 text-right font-medium">
                <abbr title="Daily Value" className="no-underline">DV</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {input.ingredients.map((ingredient, index) => (
              <IngredientRow key={`${ingredient.name}-${index}`} ingredient={ingredient} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IngredientRow(input: { ingredient: Ingredient }) {
  const { ingredient } = input;

  return (
    <>
      <tr className="border-b border-border align-top">
        <th scope="row" className="break-words py-4 pr-3 font-medium text-foreground">
          {ingredient.name}
          {ingredient.notes ? (
            <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
              {ingredient.notes}
            </span>
          ) : null}
        </th>
        <td className="break-words px-2 py-4 text-muted-foreground">
          {formatMeasuredValue(ingredient.amount)}
        </td>
        <td className="break-words py-4 pl-2 text-right text-muted-foreground">
          {ingredient.dailyValuePercent === null
            ? "Not reported"
            : `${formatNumber(ingredient.dailyValuePercent)}%`}
        </td>
      </tr>
      {ingredient.children.map((child, index) => (
        <tr key={`${child.name}-${index}`} className="border-b border-border align-top bg-card/45">
          <th scope="row" className="break-words py-3 pr-3 pl-4 text-xs font-medium text-foreground sm:text-sm">
            {child.name}
            {child.notes ? (
              <span className="mt-1 block font-normal leading-5 text-muted-foreground">
                {child.notes}
              </span>
            ) : null}
          </th>
          <td className="break-words px-2 py-3 text-xs text-muted-foreground sm:text-sm">
            {formatMeasuredValue(child.amount)}
          </td>
          <td className="break-words py-3 pl-2 text-right text-xs text-muted-foreground sm:text-sm">
            {child.dailyValuePercent === null
              ? "Not reported"
              : `${formatNumber(child.dailyValuePercent)}%`}
          </td>
        </tr>
      ))}
    </>
  );
}

function NutritionSection(input: { product: PublicProductDetail }) {
  const { nutrition } = input.product;

  return (
    <section aria-labelledby="nutrition-heading" className="border-b border-border py-12 sm:py-16">
      <SectionHeading eyebrow="NUTRITION" heading="Nutrition facts" id="nutrition-heading" />
      {nutrition.rows.length === 0 ? (
        <p className="mt-7 text-sm leading-6 text-muted-foreground sm:text-base">
          Not reported by this source.
        </p>
      ) : (
        <div className="mt-7 overflow-hidden border-t border-border">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-border font-mono text-[9px] tracking-[0.1em] text-muted-foreground sm:text-[10px]">
                <th className="w-[45%] py-3 pr-3 font-medium">NUTRIENT</th>
                <th className="w-[35%] px-2 py-3 font-medium">AMOUNT</th>
                <th className="w-[20%] py-3 pl-2 text-right font-medium">
                  <abbr title="Daily Value" className="no-underline">DV</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {nutrition.rows.map((row, index) => (
                <NutritionTableRow key={`${row.name}-${index}`} row={row} />
              ))}
            </tbody>
          </table>
          <p className="py-4 text-xs leading-5 text-muted-foreground">
            Basis: {formatNutritionBasis(nutrition.basis)}
          </p>
        </div>
      )}
    </section>
  );
}

function NutritionTableRow(input: { row: NutritionRow }) {
  return (
    <tr className="border-b border-border align-top">
      <th scope="row" className="break-words py-4 pr-3 font-medium text-foreground">
        {input.row.name}
      </th>
      <td className="break-words px-2 py-4 text-muted-foreground">
        {formatMeasuredValue(input.row.amount)}
      </td>
      <td className="break-words py-4 pl-2 text-right text-muted-foreground">
        {input.row.dailyValuePercent === null
          ? "Not reported"
          : `${formatNumber(input.row.dailyValuePercent)}%`}
      </td>
    </tr>
  );
}

function UnknownsSection(input: { product: PublicProductDetail }) {
  return (
    <section aria-labelledby="unknowns-heading" className="border-b border-border py-12 sm:py-16">
      <SectionHeading eyebrow="KNOWN GAPS" heading="What we do not know" id="unknowns-heading" />
      <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
        A missing value means Murph did not receive it from the source. It does
        not mean zero or none.
      </p>
      {input.product.unknowns.length > 0 ? (
        <ul className="mt-8 grid border-t border-border md:grid-cols-2">
          {input.product.unknowns.map((unknown, index) => (
            <li
              key={`${unknown.code}-${index}`}
              className="border-b border-border py-6 md:odd:pr-8 md:even:border-l md:even:pl-8"
            >
              <h3 className="font-serif text-xl font-semibold tracking-[-0.02em] text-foreground">
                {unknown.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {unknown.description}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-7 text-sm leading-6 text-muted-foreground">
          No additional evidence gaps are represented in this record.
        </p>
      )}
    </section>
  );
}

function ProvenanceSection(input: { product: PublicProductDetail }) {
  const { product } = input;
  const sourceUrl = toHttpUrl(product.source.url);

  return (
    <section aria-labelledby="provenance-heading" className="border-b border-border py-12 sm:py-16">
      <SectionHeading eyebrow="PROVENANCE" heading="Sources and record details" id="provenance-heading" />
      <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        <DefinitionFact label="Label source" value={product.source.name} />
        <DefinitionFact label="Source record ID" value={product.source.recordId} breakAll />
        <DefinitionFact label="Source release date" value={product.source.releaseDate ?? "Not reported"} />
        <DefinitionFact label="Last observed" value={formatIsoDate(product.source.lastSeenAt)} />
        <DefinitionFact label="Imported by Murph" value={formatIsoDate(product.source.importedAt)} />
        <DefinitionFact label="Murph product ID" value={product.productRef} breakAll />
        {sourceUrl ? (
          <div className="grid gap-1">
            <dt className="font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground">
              SOURCE URL
            </dt>
            <dd>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
                className="inline-flex min-h-11 max-w-full items-center break-all text-sm text-foreground underline decoration-border underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sourceUrl}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function SectionHeading(input: { eyebrow: string; heading: string; id: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
        {input.eyebrow}
      </p>
      <h2 id={input.id} className="mt-3 font-serif text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
        {input.heading}
      </h2>
    </div>
  );
}

function IdentityFact(input: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground">
        {input.label.toUpperCase()}
      </dt>
      <dd className={`mt-2 text-foreground ${input.breakAll ? "break-all" : "break-words"}`}>
        {input.value}
      </dd>
    </div>
  );
}

function DefinitionFact(input: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground">
        {input.label.toUpperCase()}
      </dt>
      <dd className={`mt-1 leading-6 text-foreground ${input.breakAll ? "break-all" : "break-words"}`}>
        {input.value}
      </dd>
    </div>
  );
}

function formatServing(serving: PublicProductDetail["serving"]): string {
  if (!serving) {
    return "Not reported";
  }

  if (serving.description) {
    if (serving.grams !== null && !includesGramAmount(serving.description, serving.grams)) {
      return `${serving.description} (${formatNumber(serving.grams)} g)`;
    }
    return serving.description;
  }

  if (serving.amount !== null && serving.unit) {
    return `${formatNumber(serving.amount)} ${serving.unit}`;
  }

  if (serving.grams !== null) {
    return `${formatNumber(serving.grams)} g`;
  }

  return "Not reported";
}

function formatMeasuredValue(value: Ingredient["amount"] | NutritionRow["amount"]): string {
  if (!value) {
    return "Not reported";
  }

  if (value.display) {
    return value.unit && !value.display.toLocaleLowerCase().endsWith(
      value.unit.toLocaleLowerCase(),
    )
      ? `${value.display} ${value.unit}`
      : value.display;
  }

  if (value.value !== null) {
    return value.unit
      ? `${formatNumber(value.value)} ${value.unit}`
      : formatNumber(value.value);
  }

  return "Not reported";
}

function formatTestResult(result: ProductTestObservation["result"]): string {
  switch (result.operator) {
    case "not_detected":
      return `Not detected (reported in ${result.unit})`;
    case "detected":
      return `Detected (reported in ${result.unit})`;
    case "trace":
      return `Trace (reported in ${result.unit})`;
    case "lt":
      return `Less than ${formatNullableNumber(result.value)} ${result.unit}`.trim();
    case "lte":
      return `Less than or equal to ${formatNullableNumber(result.value)} ${result.unit}`.trim();
    case "gt":
      return `Greater than ${formatNullableNumber(result.value)} ${result.unit}`.trim();
    case "gte":
      return `Greater than or equal to ${formatNullableNumber(result.value)} ${result.unit}`.trim();
    case "range":
      return formatTestResultRange(result);
    case "eq":
      return `${formatNullableNumber(result.value)} ${result.unit}`.trim();
  }
}

function formatTestResultRange(
  result: ProductTestObservation["result"],
): string {
  if (result.value !== null && result.upperValue != null) {
    return `${formatNumber(result.value)}–${formatNumber(result.upperValue)} ${result.unit}`.trim();
  }

  if (result.value !== null) {
    return `From ${formatNumber(result.value)} ${result.unit} (upper bound not reported)`.trim();
  }

  if (result.upperValue != null) {
    return `Up to ${formatNumber(result.upperValue)} ${result.unit} (lower bound not reported)`.trim();
  }

  return result.unit ? `Range not reported (${result.unit})` : "Range not reported";
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "Value not reported" : formatNumber(value);
}

function formatNormalizedTestResult(
  observation: ProductTestObservation,
): string {
  const normalized = observation.normalizedResult;
  if (!normalized) {
    return "Value not reported";
  }

  if (observation.result.operator === "range") {
    if (normalized.upperValue != null) {
      return `${formatNumber(normalized.value)}–${formatNumber(normalized.upperValue)} ${normalized.unit}`.trim();
    }

    return `From ${formatNumber(normalized.value)} ${normalized.unit} (upper bound not reported)`.trim();
  }

  return `${formatNumber(normalized.value)} ${normalized.unit}`.trim();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 15 }).format(value);
}

function hasDistinctNormalizedResult(observation: ProductTestObservation): boolean {
  const normalized = observation.normalizedResult;
  if (!normalized) {
    return false;
  }

  if (observation.result.operator !== "eq" && observation.result.operator !== "range") {
    return true;
  }

  return observation.result.value !== normalized.value
    || (observation.result.upperValue ?? null) !== (normalized.upperValue ?? null)
    || observation.result.unit !== normalized.unit
    || observation.result.basis !== normalized.basis;
}

function formatEvidenceBasis(value: string): string {
  switch (value) {
    case "product_mass":
      return "per unit of product mass";
    case "oral_total_dietary_exposure":
      return "total daily oral exposure";
    default:
      return value.replaceAll("_", " ");
  }
}

function includesGramAmount(description: string, grams: number): boolean {
  const gramAmount = `${formatNumber(grams)} g`.toLocaleLowerCase();
  const normalized = description
    .toLocaleLowerCase()
    .replaceAll("grams", "g")
    .replaceAll("gram", "g")
    .replace(/\s+/gu, " ");
  return normalized.includes(gramAmount);
}

function formatMatchMethod(method: ProductTestObservation["testedProduct"]["matchMethod"]): string {
  switch (method) {
    case "exact_upc":
      return "Linked by exact UPC";
    case "exact_source_id":
      return "Linked by exact source record";
    case "manual_confirmed":
      return "Exact product match, manually reviewed";
  }
}

function formatNutritionBasis(basis: PublicProductDetail["nutrition"]["basis"]): string {
  switch (basis) {
    case "per_serving":
      return "Per serving";
    case "per_100_g":
      return "Per 100 g";
    case "mixed":
      return "Mixed source bases";
    case "unavailable":
      return "Not reported";
  }
}

function formatIsoDate(value: string | null): string {
  return value ? value.slice(0, 10) : "Not reported";
}

function createCorrectionHref(productRef: string): string {
  const subject = encodeURIComponent("Product data correction");
  const body = encodeURIComponent(`Murph product ID: ${productRef}`);
  return `mailto:support@withmurph.ai?subject=${subject}&body=${body}`;
}

function toHttpUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
