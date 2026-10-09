import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "../../src/server/config.js";
import { createApp } from "../../src/server/app.js";
import { passwordHash } from "../../src/server/store.js";
import { Fixture } from "../fixture.js";
const dir = path.resolve(".test-data/e2e");
await rm(dir, { recursive: true, force: true });
const root = path.join(dir, "projects");
await mkdir(path.join(root, "alpha"), { recursive: true });
await mkdir(path.join(root, "beta"), { recursive: true });
await writeFile(
  path.join(root, "alpha", "hello.ts"),
  'const hello = "world";\n',
);
await writeFile(
  path.join(root, "alpha", "README.md"),
  "# Fixture Markdown\n\n**Safe** preview.\n<script>alert(1)</script>",
);
const cfg = config({
  PROJECT_ROOTS: JSON.stringify([root]),
  DATA_DIR: path.join(dir, "data"),
  PORT: "3107",
  PUBLIC_URL: "http://127.0.0.1:3107",
});
const fixture = new Fixture(root);
const { app, store } = await createApp(cfg, fixture);
store.set("password", passwordHash("e2e-only-fixture-password"));
await app.listen({ host: "127.0.0.1", port: 3107 });
for (const s of ["SIGTERM", "SIGINT"])
  process.on(s, () => void app.close().then(() => process.exit(0)));
