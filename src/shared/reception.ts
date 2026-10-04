import { z } from 'zod';

const id = z.string().min(1);
const sequence = z.number().int().nonnegative();
const record = z.record(z.string(), z.unknown());
export const receptionExposureSchema = z.enum(['not_started', 'started', 'interrupted', 'completed']);
export const receptionContactSchema = z.object({ rawChunks: z.array(z.string()), digits: z.string(), version: sequence, confirmedVersion: sequence.optional(), source: z.enum(['simulated_web_field', 'dictated']), issue: z.string().optional() });
export type ReceptionContact = z.infer<typeof receptionContactSchema>;
export const receptionActionSchema = z.enum(['book', 'reschedule', 'cancel', 'summary_link']);
export const receptionDraftSchema = z.object({
  draftId: id, action: receptionActionSchema, subjectKey: id, subjectRevision: sequence, selectionRevision: sequence,
  patientName: z.string().optional(), callerName: z.string().optional(), relationship: z.string().optional(),
  doctorId: id.optional(), serviceId: id.optional(), targetAppointmentId: id.optional(), acceptedOfferId: id.optional(), operationId: id.optional(), contact: receptionContactSchema,
});
export type ReceptionDraft = z.infer<typeof receptionDraftSchema>;
export const receptionOfferSchema = z.object({
  offerId: id, draftId: id, action: receptionActionSchema, subjectKey: id, subjectRevision: sequence, selectionRevision: sequence,
  appointmentVersion: sequence.optional(), doctorId: z.string(), slotIds: z.array(id), startsAtUtc: z.string(), doctorNameAr: z.string(), doctorNameEn: z.string(), issuedInputSequence: sequence, expiresAt: z.string(), labels: record, consequence: z.string().optional(),
});
export type ReceptionOffer = z.infer<typeof receptionOfferSchema>;
export const receptionSnapshotSchema = z.object({
  sessionId: id, version: sequence, status: z.enum(['active', 'paused', 'closed']), callingNumber: z.string().optional(),
  clock: z.object({ nowIso: z.string(), timeZone: z.literal('Asia/Riyadh'), localDate: z.string() }),
  directory: z.array(z.object({ doctorId: id, nameAr: z.string(), nameEn: z.string(), specialtyId: id, specialtyAr: z.string(), specialtyEn: z.string() })),
  clinic: record, patientName: z.string().optional(), contact: receptionContactSchema, draft: receptionDraftSchema.optional(), offers: z.array(receptionOfferSchema),
  operations: z.array(z.object({ operationId: id, status: z.enum(['ready', 'committed', 'rejected']), result: record.optional() })),
});
export type ReceptionSnapshot = z.infer<typeof receptionSnapshotSchema>;
export const receptionCommandSchema = z.object({
  eventId: id, expectedVersion: sequence, tool: id, args: record,
  context: z.object({ connectionId: id, inputTurnId: id, inputSequence: sequence, eventSequence: sequence, inputStartedEventSequence: sequence, outputId: id.optional(), exposure: receptionExposureSchema.optional(), source: z.enum(['text', 'microphone']), attribution: z.enum(['known', 'uncertain']) }),
});
export type ReceptionCommand = z.infer<typeof receptionCommandSchema>;
export const receptionMediaEventSchema = z.object({ eventId: id, connectionId: id, outputId: id, inputSequence: sequence, eventSequence: sequence, medium: z.enum(['audio', 'text']), exposure: receptionExposureSchema, offerIds: z.array(id) });
export type ReceptionMediaEvent = z.infer<typeof receptionMediaEventSchema>;
export const receptionStatusSchema = z.enum(['ok', 'availability', 'offers', 'updated', 'needs_details', 'needs_clarification', 'invalid_contact', 'unknown', 'not_found', 'ambiguous', 'conflict', 'unavailable', 'ready', 'committed', 'rejected', 'paused', 'closed', 'error']);
export const receptionResultSchema = z.object({ status: receptionStatusSchema, facts: record.optional(), issues: z.array(z.string()).optional(), missingFields: z.array(z.string()).optional(), snapshot: receptionSnapshotSchema, operationId: id.optional(), result: record.optional() });
export type ReceptionResult = z.infer<typeof receptionResultSchema>;
export const receptionEventResultSchema = z.union([receptionResultSchema, z.object({status:z.literal('unresolved'),snapshot:receptionSnapshotSchema})]);
export type ReceptionEventResult = z.infer<typeof receptionEventResultSchema>;
export const receptionCloseSchema = z.object({ eventId: id, expectedVersion: sequence, intent: z.string().optional(), outcome: z.enum(['completed', 'declined', 'unresolved', 'emergency']) });
export type ReceptionClose = z.infer<typeof receptionCloseSchema>;
