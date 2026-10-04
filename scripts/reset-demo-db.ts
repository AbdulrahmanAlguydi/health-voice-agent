import "dotenv/config";
import { resolve } from "node:path";
import { openDatabase } from "../src/server/db/connection";
import { resetDemoDatabase } from "../src/server/services/bookingService";

if ((process.env.NODE_ENV ?? "development") !== "development") {
  throw new Error("The demo database reset is available only when NODE_ENV=development.");
}

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/health-voice-agent.sqlite");
const db = openDatabase(databasePath);
try {
  resetDemoDatabase(db);
  console.info("Removed demo bookings and restored the seeded appointment availability.");
} finally {
  db.close();
}
