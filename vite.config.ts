import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

import packageJson from "./package.json" with { type: "json" };
import { BARREL, VENDOR } from "./vite/chunks";
import { contentSecurityPolicy } from "./vite/csp";

const root = fileURLToPath(new URL(".", import.meta.url));
const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ mode }) => {
  // Reads .env files and VITE_* variables from the shell, as the app does.
  const analyticsUrl = loadEnv(mode, root, "VITE_")["VITE_ANALYTICS_URL"] || undefined;

  return {
    // Relative asset paths, so the build works from any subpath (GitHub Pages).
    base: "./",
    plugins: [react(), tailwindcss(), contentSecurityPolicy({ analyticsUrl })],
    resolve: {
      alias: { "@": src },
    },
    define: {
      // The only build fact a usage record carries. See src/analytics.
      "import.meta.env.PMO_BUILDER_VERSION": JSON.stringify(packageJson.version),
    },
    worker: {
      format: "es",
    },
    build: {
      target: "es2023",
      sourcemap: true,
      rolldownOptions: {
        treeshake: {
          // The index files under src only re-export. Saying so lets the
          // bundler follow each import to the module that defines it, so a
          // primitive or helper that only one step uses loads with that step
          // instead of with the shell.
          moduleSideEffects: (id) => !BARREL.test(id),
        },
        output: {
          codeSplitting: {
            groups: [
              // What every page needs and that changes only with an upgrade, in
              // its own chunk so a new release does not invalidate it.
              { name: "vendor", test: VENDOR, priority: 10 },
            ],
          },
        },
      },
    },
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "domain",
            environment: "node",
            include: ["src/domain/**/*.test.ts", "src/worker/**/*.test.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "ui",
            environment: "jsdom",
            include: ["src/**/*.test.{ts,tsx}"],
            exclude: ["src/domain/**", "src/worker/**", "src/analytics/**"],
            setupFiles: ["src/test/setup.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "analytics",
            environment: "jsdom",
            include: ["src/analytics/**/*.test.{ts,tsx}"],
            setupFiles: ["src/test/setup.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "tooling",
            environment: "node",
            include: ["vite/**/*.test.ts"],
          },
        },
      ],
    },
  };
});
