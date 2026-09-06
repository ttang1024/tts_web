// Bundles every tests/*.test.ts with esbuild (which resolves the "@/" alias and
// strips the types) and hands the output to Node's own test runner. No test
// framework: the runner ships with Node, and esbuild is already the fastest way
// to turn one TypeScript file into something it can run.
//
// Node runs each test file in its own process, which the storage tests depend
// on — lib/idb caches its database connection, so "an empty library" can only
// mean a fresh process.

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, ".test-build");

rmSync(outdir, { recursive: true, force: true });

const entryPoints = readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => path.join(root, "tests", name));

if (entryPoints.length === 0) {
  console.error("No tests found.");
  process.exit(1);
}

await build({
  entryPoints,
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  alias: { "@": root },
  logLevel: "warning",
});

// Name the built files explicitly: Node's test runner takes file paths, and a
// bare directory is read as a module to require.
const filter = process.argv.slice(2);
const built = entryPoints
  .map((entry) => path.join(outdir, `${path.basename(entry, ".ts")}.cjs`))
  .filter((file) => filter.length === 0 || filter.some((name) => path.basename(file).startsWith(name)));

if (built.length === 0) {
  console.error(`No tests matched: ${filter.join(", ")}`);
  process.exit(1);
}

const args = ["--test", ...built];
const { status } = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root });
process.exit(status ?? 1);
