import { existsSync } from "node:fs";
for (const path of ["../../.env", ".env"])
  if (existsSync(path)) process.loadEnvFile(path);
