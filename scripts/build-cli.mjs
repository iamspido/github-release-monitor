import { build } from "esbuild";

await build({
  entryPoints: ["src/cli/grm-cli.ts"],
  outfile: ".next/cli/grm-cli.mjs",
  bundle: true,
  external: ["better-sqlite3"],
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
});
