import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { MurphSafeProductDetail } from "@/src/components/murph-safe/product-detail";
import { getPublicProductDetail } from "@/src/lib/public-products/service";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

type ProductPageProps = {
  params: Promise<{ productRef: string }>;
};

const getProduct = cache(getPublicProductDetail);

export async function generateMetadata(input: ProductPageProps): Promise<Metadata> {
  const { productRef } = await input.params;
  const product = await getProduct(productRef);

  if (!product) {
    return {
      ...createMurphPageMetadata({
        description: "This Murph Safe product record is unavailable.",
        title: "Product unavailable | Murph Safe",
      }),
      robots: { follow: false, index: false },
    };
  }

  const brandSuffix = product.brand ? ` by ${product.brand}` : "";
  const description = `View ingredients, nutrition, linked product tests, and known evidence gaps for ${product.name}${brandSuffix}.`;

  return {
    ...createMurphPageMetadata({
      alternates: { canonical: `/search/products/${product.productRef}` },
      description,
      openGraph: { type: "article" },
      title: `${product.name} | Murph Safe`,
    }),
    robots: { follow: true, index: true },
  };
}

export default async function MurphSafeProductPage(input: ProductPageProps) {
  const { productRef } = await input.params;
  const product = await getProduct(productRef);

  if (!product) {
    notFound();
  }

  return <MurphSafeProductDetail product={product} />;
}
