import { Router } from "express";
import type Database from "better-sqlite3";
import {
  CancelBookingRequestSchema,
  ConfirmBookingRequestSchema,
  PrepareGuestBookingRequestSchema,
  PrepareBookingRequestSchema,
} from "../../shared/contracts";
import { BookingService } from "../services/bookingService";

export function createBookingRouter(db: Database.Database) {
  const router = Router();
  const service = new BookingService(db);

  router.post("/prepare", (request, response) => {
    const parsed = PrepareBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "Please provide a patient, doctor, and slot." });
      return;
    }

    const result = service.prepare(parsed.data);
    response.status(result.status === "pending" || result.status === "ambiguous_doctor" ? 200 : result.status === "slot_unavailable" ? 409 : 404).json(result);
  });

  router.post("/prepare-guest", (request, response) => {
    const parsed = PrepareGuestBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "Please provide a full name, mobile number, doctor, and slot." });
      return;
    }

    const result = service.prepareGuest(parsed.data);
    response.status(result.status === "pending" || result.status === "ambiguous_doctor" ? 200 : result.status === "slot_unavailable" ? 409 : 404).json(result);
  });

  router.post("/confirm", (request, response) => {
    const parsed = ConfirmBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "A current final confirmation is required." });
      return;
    }

    response.json(service.confirm(parsed.data));
  });

  router.post("/cancel", (request, response) => {
    const parsed = CancelBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "A pending confirmation is required." });
      return;
    }

    response.json(service.cancel(parsed.data.pendingId, parsed.data.language));
  });

  return router;
}
