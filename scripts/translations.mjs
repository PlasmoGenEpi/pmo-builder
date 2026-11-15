// Manages translation review: private links for reviewers, and pulling their
// suggestions into the catalogs. See scripts/translations/run.ts for the
// commands, and docs/translation.md. Loaded through Vite so that the app's
// own modules resolve as they do in the app.
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: "custom",
  logLevel: "error",
});
try {
  const { run } = await server.ssrLoadModule("/scripts/translations/run.ts");
  process.exitCode = await run(process.argv.slice(2));
} finally {
  await server.close();
}
