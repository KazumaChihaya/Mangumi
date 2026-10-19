import "./env.ts";
import { createApp } from "./app.ts";
const { app, config } = await createApp();
await app.listen({
  port: config.port,
  host: config.production ? "0.0.0.0" : "127.0.0.1",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
