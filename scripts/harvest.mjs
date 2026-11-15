// Builds the catalogue of published PMOs from the Zenodo community into
// public/repository/. Run before `pnpm build`; see src/domain/repository/run.ts
// for the options. The work is done by the app's own modules, loaded through
// Vite so that their imports resolve as they do in the app.
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: "custom",
  logLevel: "error",
});
try {
  const { run } = await server.ssrLoadModule("/src/domain/repository/run.ts");
  process.exitCode = await run(process.argv.slice(2));
} finally {
  await server.close();
}
