import { Router } from "express";
import type Database from "better-sqlite3";
import { PatientLookupRequestSchema } from "../../shared/contracts";
import { lookupPatient } from "../services/patientService";

export function createPatientRouter(db: Database.Database) {
  const router = Router();

  router.post("/lookup", (request, response) => {
    const parsed = PatientLookupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "Please provide a valid patient ID." });
      return;
    }

    const result = lookupPatient(db, parsed.data.patientId, parsed.data.language);
    response.status(result.status === "found" ? 200 : 404).json(result);
  });

  return router;
}
