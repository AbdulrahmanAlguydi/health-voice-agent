import { Router } from "express";
import type Database from "better-sqlite3";
import { AvailableSlotsRequestSchema } from "../../shared/contracts";
import { getAvailableSlots } from "../services/slotService";

export function createSlotRouter(db: Database.Database) {
  const router = Router();

  router.post("/search", (request, response) => {
    const parsed = AvailableSlotsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "Please provide a supported doctor and date." });
      return;
    }

    response.json(getAvailableSlots(db, parsed.data));
  });

  return router;
}
