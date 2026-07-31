import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Environment — Murph",
  robots: { follow: false, index: false },
};

export default function EnvironmentPrintPage() {
  redirect("/environment");
}
