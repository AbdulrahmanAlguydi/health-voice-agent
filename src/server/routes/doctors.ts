import { Router } from "express";
import type Database from "better-sqlite3";
import { DoctorDetailsRequestSchema, DoctorSearchRequestSchema, SpecialtyListRequestSchema } from "../../shared/contracts";
import { getSpecialtyDirectory, searchDoctors } from "../services/directoryService";
import { getDoctorDetails } from "../services/doctorService";

export function createDoctorRouter(db: Database.Database) {
  const router = Router();

  router.post("/specialties", (request, response) => {
    const parsed = SpecialtyListRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "Please select Arabic or English." });
      return;
    }

    response.json(getSpecialtyDirectory(db, parsed.data));
  });

  router.post("/search", (request, response) => {
    const parsed = DoctorSearchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "Please provide a supported search filter." });
      return;
    }

    response.json(searchDoctors(db, parsed.data));
  });

  router.post("/details", (request, response) => {
    const parsed = DoctorDetailsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ status: "invalid_request", responseText: "Please provide a supported doctor identifier." });
      return;
    }

    response.json(getDoctorDetails(db, parsed.data));
  });

  return router;
}
