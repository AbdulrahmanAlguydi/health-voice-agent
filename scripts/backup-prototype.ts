import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import "dotenv/config";

// Online SQLite backup also includes committed WAL pages. Never copy the live file alone.
export async function backupPrototype(root: string, databasePath: string, destination: string) {
  if (existsSync(destination)) throw new Error("Backup destination already exists.");
  mkdirSync(destination, { recursive: true });
  const inventory: Array<{ path: string; bytes: number; sha256: string }> = [];
  const copy = (path: string) => {
    const name = relative(root, path).replaceAll("\\", "/");
    if (/(^|\/)(node_modules|dist|coverage|\.git|\.playwright-cli|data|output|_bmad|_bmad-output|backups)(\/|$)/.test(name)) return;
    if (/(^|\/)\.env($|\.)/.test(name) && name !== ".env.example") return;
    if (/\.(sqlite|sqlite-wal|sqlite-shm|db|pem|key)$/i.test(name)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) copy(join(path, entry));
      return;
    }
    const target = join(destination, "source", name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
    const bytes = readFileSync(target);
    inventory.push({ path: `source/${name}`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  for (const entry of readdirSync(root)) copy(join(root, entry));
  let database: Record<string, unknown> = { source: databasePath, present: false };
  if (existsSync(databasePath)) {
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    const target = join(destination, "legacy.sqlite");
    try { await db.backup(target); } finally { db.close(); }
    const check = new Database(target, { readonly: true });
    try {
      if (check.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup integrity check failed.");
      database = { source: databasePath, present: true, integrity: "ok", tables: check.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() };
    } finally { check.close(); }
    const bytes = readFileSync(target);
    inventory.push({ path: "legacy.sqlite", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  for (const item of inventory) {
    const actual = createHash("sha256").update(readFileSync(join(destination, item.path))).digest("hex");
    if (actual !== item.sha256) throw new Error(`Inventory mismatch: ${item.path}`);
  }
  writeFileSync(join(destination, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), database, inventory }, null, 2));
  return { destination, files: inventory.length, database };
}

if (process.argv[1]?.endsWith("backup-prototype.ts")) {
  const root = resolve(process.cwd());
  const destination = resolve(process.argv[2] ?? `backups/prototype-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
  console.info(await backupPrototype(root, resolve(process.env.DATABASE_PATH ?? "data/health-voice-agent.sqlite"), destination));
}
