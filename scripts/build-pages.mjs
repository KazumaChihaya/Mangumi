import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const member = fileURLToPath(new URL("../apps/member/", import.meta.url));
const require = createRequire(join(member, "package.json"));
const cli = join(dirname(require.resolve("expo/package.json")), "bin/cli");
const basePath = (process.env.EXPO_PUBLIC_BASE_PATH || "/Mangumi").replace(
  /\/+$/,
  "",
);
if (!/^\/[A-Za-z0-9._-]+$/.test(basePath))
  throw new Error(
    "EXPO_PUBLIC_BASE_PATH must be one repository path, e.g. /Mangumi",
  );

const result = spawnSync(
  process.execPath,
  [cli, "export", "--platform", "web", "--output-dir", "dist-pages"],
  {
    cwd: member,
    env: { ...process.env, EXPO_PUBLIC_BASE_PATH: basePath },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const output = resolve(member, "dist-pages");
async function collectHtml(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectHtml(path)));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}
// GitHub Pages serves nested routes as directories, including /admin/.
for (const file of await collectHtml(output)) {
  if (
    ["index.html", "offline.html", "+not-found.html"].includes(basename(file))
  )
    continue;
  const directory = file.slice(0, -5);
  await mkdir(directory, { recursive: true });
  await copyFile(file, join(directory, "index.html"));
}
await copyFile(join(output, "+not-found.html"), join(output, "404.html"));
await writeFile(join(output, ".nojekyll"), "");
const worker = join(output, "sw.js");
await writeFile(
  worker,
  (await readFile(worker, "utf8")).replace(
    "__MANGUMI_BUILD__",
    process.env.GITHUB_SHA || randomUUID(),
  ),
);
process.stdout.write(
  `GitHub Pages build: ${output}\nBase path: ${basePath}/\n`,
);
