// dfc:db:check - load config, connect, authenticate, select ns/db, run a tiny
// read query, and print the connection status. Human-readable output.

import { assertUsableConfig, connect, loadConfig, queryResult } from "../src/memory/surreal.js";

async function main(): Promise<void> {
  const cfg = loadConfig();

  console.log("DFC SurrealDB dev memory :: connection check");
  console.log(`  URL:       ${cfg.url || "(unset)"}`);
  console.log(`  Namespace: ${cfg.namespace}`);
  console.log(`  Database:  ${cfg.database}`);
  console.log(`  Repo ID:   ${cfg.repoId}`);
  console.log(`  User:      ${cfg.username || "(unset)"}`);
  console.log(`  Auth:      ${cfg.authScope}`);

  try {
    assertUsableConfig(cfg);
  } catch (err) {
    console.error(`  Status:    NOT CONFIGURED - ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    const db = await connect(cfg);
    try {
      const res = await queryResult<number>(db, "RETURN 1");
      console.log(`  Status:    CONNECTED  (read query returned ${JSON.stringify(res)})`);
    } finally {
      await db.close();
    }
  } catch (err) {
    console.error(`  Status:    CONNECTION FAILED - ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
