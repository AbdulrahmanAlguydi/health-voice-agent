import { getDatabase } from "@netlify/database";
import type { Pool } from "pg";

export type ReceptionOptions = { clock?: () => Date };

/** Netlify supplies the correct Postgres branch in Functions and local dev. */
export function getReceptionPool(): Pool {
  return getDatabase().pool as Pool;
}
