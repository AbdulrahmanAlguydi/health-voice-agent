import express from "express";
import type Database from "better-sqlite3";
import type { Pool } from "pg";
import { healthRouter } from "./routes/health";
import { createPatientRouter } from "./routes/patients";
import { createDoctorRouter } from "./routes/doctors";
import { createSlotRouter } from "./routes/slots";
import { createBookingRouter } from "./routes/bookings";
import { createGeminiRouter } from "./routes/gemini";
import type { GeminiTokenIssuer } from "./services/geminiTokenService";
import { createOutputVerificationRouter } from "./routes/outputVerification";
import type { OutputVerifier } from "../shared/outputVerification";
import { createReceptionRouter, receptionTimingLogger } from "./reception/routes";
import { ReceptionService } from "./reception/service";

export type AppDependencies = {
  db?: Database.Database;
  geminiTokenIssuer?: GeminiTokenIssuer;
  outputVerifier?: OutputVerifier;
  receptionPool?: Pool;
  receptionService?: ReceptionService;
  exposeReceptionActivity?: boolean;
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use("/api/reception", receptionTimingLogger);
  app.use(express.json());
  app.use("/api/health", healthRouter);
  const reception = dependencies.receptionService ?? (dependencies.receptionPool ? new ReceptionService(dependencies.receptionPool) : undefined);
  app.use("/api/gemini", createGeminiRouter(dependencies.geminiTokenIssuer, reception ? (id) => reception.getSnapshot(id) : undefined));
  app.use("/api/gemini", createOutputVerificationRouter(dependencies.outputVerifier));
  if (reception) app.use("/api/reception", createReceptionRouter(reception, { exposeActivity: dependencies.exposeReceptionActivity === true }));
  if (dependencies.db) {
    app.use("/api/patients", createPatientRouter(dependencies.db));
    app.use("/api/doctors", createDoctorRouter(dependencies.db));
    app.use("/api/slots", createSlotRouter(dependencies.db));
    app.use("/api/bookings", createBookingRouter(dependencies.db));
  }
  // Database failures return a stable API error. Never leak SQL, stack traces,
  // connection strings, or provider details to callers.
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(503).json({ error: "service_unavailable" });
  });
  return app;
}
