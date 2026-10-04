import { z } from "zod";

export const SpeechEvidenceSchema = z.object({
  sourceText: z.string().max(24000),
  requiredPhrases: z.array(z.string().max(1000)).max(60),
  groundedPhrases: z.array(z.string().max(1000)).max(300).optional(),
  receptionIntent: z.enum(["request_patient_id", "request_guest_name", "request_guest_mobile"]).optional(),
  allowRelativeDates: z.boolean().optional(),
  optionalAppointmentDates: z.boolean().optional(),
  appointmentDates: z.array(z.object({
    gregorian: z.string().max(1000), hijri: z.string().max(1000), relative: z.string().max(1000).optional(),
  }).strict()).max(60).optional(),
  records: z.array(z.object({
    name: z.string().max(200).optional(),
    specialty: z.string().max(200).optional(),
    clinicLocation: z.string().max(300).optional(),
    spokenLanguages: z.array(z.string().max(40)).max(5).optional(),
  }).strict()).max(240).optional(),
  phraseVariants: z.array(z.object({ phrase: z.string().max(1000), variants: z.array(z.string().max(1000)).max(60) }).strict()).max(60).optional(),
}).strict();
export const OutputVerificationRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(5000),
  language: z.enum(["ar", "en"]),
  expectedText: z.string().max(24000).optional(),
  evidence: SpeechEvidenceSchema.optional(),
}).strict();
export const OutputVerificationVerdictSchema = z.object({
  approved: z.boolean(),
  conversational: z.boolean(),
  reason: z.enum(["supported", "unsupported_fact", "changed_details", "out_of_scope", "wrong_language", "wrong_step"]),
}).strict().refine((v) => v.approved === (v.reason === "supported") && (v.approved || !v.conversational));

export type OutputVerificationRequest = z.infer<typeof OutputVerificationRequestSchema>;
export type OutputVerificationVerdict = z.infer<typeof OutputVerificationVerdictSchema>;
export type OutputVerifier = (input: OutputVerificationRequest, signal?: AbortSignal) => Promise<OutputVerificationVerdict>;
