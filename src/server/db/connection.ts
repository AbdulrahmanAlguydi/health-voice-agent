import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { seedDatabase } from "./seed";

const schemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export function openDatabase(path: string): Database.Database {
  const databasePath = path === ":memory:" ? path : resolve(path);
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    if (databasePath !== ":memory:") {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
    }
    db.exec(schemaSql);
    const patientColumns = db.pragma("table_info(patients)") as Array<{ name: string }>;
    if (!patientColumns.some(({ name }) => name === "mobile_number")) {
      db.exec("ALTER TABLE patients ADD COLUMN mobile_number TEXT");
    }
    seedDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
