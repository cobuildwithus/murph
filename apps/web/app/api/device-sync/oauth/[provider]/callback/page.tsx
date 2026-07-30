import type { Metadata } from "next";

export { default } from "../../../connect/[provider]/callback/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Finish device connection",
};
