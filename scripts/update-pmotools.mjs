// Rebuilds ../pmotools-ts, packs it into vendor/, and reinstalls it here.
// pmotools-ts is not published yet, so the app depends on a vendored tarball.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const library = process.argv[2] ?? fileURLToPath(new URL("../../pmotools-ts", import.meta.url));
const vendor = fileURLToPath(new URL("../vendor", import.meta.url));

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });

run("pnpm", ["build"], library);
for (const file of readdirSync(vendor)) {
  if (file.startsWith("pmotools-ts-") && file.endsWith(".tgz")) rmSync(`${vendor}/${file}`);
}
run("pnpm", ["pack", "--pack-destination", vendor], library);
const tarball = readdirSync(vendor).find((file) => file.endsWith(".tgz"));
if (tarball === undefined) throw new Error("pnpm pack produced no tarball");
run("pnpm", ["add", `pmotools-ts@file:vendor/${tarball}`], root);
console.log(`pmotools-ts updated from ${library} (${tarball})`);
