import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../apps/member/", import.meta.url));
const entry = fileURLToPath(
  new URL("../apps/member/node_modules/expo/bin/cli", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [entry, "export", "--platform", "web", "--output-dir", "dist-live"],
  {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: "/api",
      EXPO_PUBLIC_BASE_PATH: "",
      EXPO_NO_DOTENV: "1",
      EXPO_NO_TELEMETRY: "1",
    },
  },
);
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const worker = resolve(cwd, "dist-live/sw.js");
  await writeFile(
    worker,
    (await readFile(worker, "utf8")).replaceAll(
      "__MANGUMI_BUILD__",
      randomUUID(),
    ),
  );
}
