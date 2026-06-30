import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      ".next-smoke/**",
      ".next-smoke-*/**",
      ".next-smoke-e2e*/**",
      "app/.well-known/workflow/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
