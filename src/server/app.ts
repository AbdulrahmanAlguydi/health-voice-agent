import express from "express";
import type Database from "better-sqlite3";
import { healthRouter } from "./routes/health";
import { createPatientRouter } from "./routes/patients";
import { createDoctorRouter } from "./routes/doctors";
import { createSlotRouter } from "./routes/slots";
import { createBookingRouter } from "./routes/bookings";
import { createGeminiRouter } from "./routes/gemini";
import type { GeminiTokenIssuer } from "./services/geminiTokenService";
import { createOutputVerificationRouter } from "./routes/outputVerification";
import type { OutputVerifier } from "../shared/outputVerification";
import { createReceptionRouter } from "./reception/routes";
import { ReceptionService } from "./reception/service";

export type AppDependencies = {
  db?: Database.Database;
  geminiTokenIssuer?: GeminiTokenIssuer;
  outputVerifier?: OutputVerifier;
  receptionDb?: Database.Database;
  receptionService?: ReceptionService;
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use(express.json());
  app.use("/api/health", healthRouter);
  const reception = dependencies.receptionService ?? (dependencies.receptionDb ? new ReceptionService(dependencies.receptionDb) : undefined);
  app.use("/api/gemini", createGeminiRouter(dependencies.geminiTokenIssuer, reception ? (id) => reception.getSnapshot(id) : undefined));
  app.use("/api/gemini", createOutputVerificationRouter(dependencies.outputVerifier));
  if (reception) app.use("/api/reception", createReceptionRouter(reception));
  if (dependencies.db) {
    app.use("/api/patients", createPatientRouter(dependencies.db));
    app.use("/api/doctors", createDoctorRouter(dependencies.db));
    app.use("/api/slots", createSlotRouter(dependencies.db));
    app.use("/api/bookings", createBookingRouter(dependencies.db));
  }
  return app;
}
