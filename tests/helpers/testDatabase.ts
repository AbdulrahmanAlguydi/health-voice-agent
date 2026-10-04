import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/server/db/connection";

export function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "health-agent-route-"));
  const db = openDatabase(join(directory, "prototype.sqlite"));

  return {
    db,
    path: join(directory, "prototype.sqlite"),
    dispose() {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
