import { z } from "zod";

export const LanguageSchema = z.enum(["en", "ar"]);
export type Language = z.infer<typeof LanguageSchema>;

export const PatientLookupRequestSchema = z
  .object({
    // Speech recognition may insert pauses as spaces between ID characters.
    // Normalize only this lookup input; booking still requires the verified canonical ID.
    patientId: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9\s-]+$/i)
      .transform((patientId) => patientId.replace(/\s+/g, ""))
      .pipe(z.string().min(1).max(20).regex(/^[a-z0-9-]+$/i)),
    language: LanguageSchema,
  })
  .strict();

export type PatientLookupRequest = z.infer<typeof PatientLookupRequestSchema>;

export type PatientLookupResult =
  | {
      status: "found";
      patient: { patientId: string; fullName: string };
      responseText: string;
    }
  | { status: "not_found"; responseText: string };

export const DoctorSearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(120).optional(),
    specialty: z.string().trim().min(1).max(80).optional(),
    spokenLanguage: LanguageSchema.optional(),
    location: z.string().trim().min(1).max(100).optional(),
    language: LanguageSchema,
  })
  .strict();

export type DoctorSearchRequest = z.infer<typeof DoctorSearchRequestSchema>;

export type DoctorSummary = {
  doctorId: string;
  name: string;
  specialty: string;
  clinicLocation: string;
  spokenLanguages: Language[];
};

export type DoctorSearchResult =
  | { status: "ok"; doctors: DoctorSummary[]; responseText: string }
  | { status: "not_found"; doctors: []; responseText: string }
  | { status: "ambiguous"; candidates: DoctorSummary[]; responseText: string };

export const SpecialtyListRequestSchema = z.object({ language: LanguageSchema }).strict();
export type SpecialtyListRequest = z.infer<typeof SpecialtyListRequestSchema>;
export type SpecialtySummary = { specialtyId: string; name: string };
export type SpecialtyListResult = { status: "ok"; specialties: SpecialtySummary[]; responseText: string };

export const DoctorDetailsRequestSchema = z
  .object({
    doctorIdentifier: z.string().trim().min(1).max(120),
    language: LanguageSchema,
  })
  .strict();

export type DoctorDetailsRequest = z.infer<typeof DoctorDetailsRequestSchema>;

export type DoctorDetailsResult =
  | { status: "found"; doctor: DoctorSummary; responseText: string }
  | { status: "not_found"; responseText: string }
  | { status: "ambiguous"; candidates: DoctorSummary[]; responseText: string };

export const AvailableSlotsRequestSchema = z
  .object({
    doctorIdentifier: z.string().trim().min(1).max(120),
    requestedDate: z.iso.date().optional(),
    dateStyle: z.enum(["relative", "gregorian", "hijri"]).optional(),
    language: LanguageSchema,
  })
  .strict();

export type AvailableSlotsRequest = z.infer<typeof AvailableSlotsRequestSchema>;

export type SlotSummary = {
  slotId: string;
  startsAtUtc: string;
  spokenDateTime: string;
  spokenHijriDateTime?: string;
  relativeDateTime?: string;
  relativeDays?: number;
  relativeComputedOn?: string;
};

export type AvailableSlotsResult =
  | { status: "ok"; doctor: DoctorSummary; slots: SlotSummary[]; responseText: string }
  | {
      status: "unavailable";
      doctor: DoctorSummary;
      slots: [];
      alternatives: SlotSummary[];
      responseText: string;
    }
  | { status: "not_found"; responseText: string }
  | { status: "ambiguous"; candidates: DoctorSummary[]; responseText: string };

export const PrepareBookingRequestSchema = z
  .object({
    patientId: z.string().trim().min(1).max(20).regex(/^[a-z0-9-]+$/i),
    doctorIdentifier: z.string().trim().min(1).max(120),
    slotId: z.string().trim().min(1).max(100),
    calendar: z.enum(["gregorian", "hijri"]).optional(),
    language: LanguageSchema,
  })
  .strict();

const MobileNumberSchema = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .transform((mobileNumber) => mobileNumber
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)))
  .transform((mobileNumber) => mobileNumber.replace(/[\s().-]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/));

export const PrepareGuestBookingRequestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    mobileNumber: MobileNumberSchema,
    doctorIdentifier: z.string().trim().min(1).max(120),
    slotId: z.string().trim().min(1).max(100),
    calendar: z.enum(["gregorian", "hijri"]).optional(),
    language: LanguageSchema,
  })
  .strict();
export type PrepareGuestBookingRequest = z.infer<typeof PrepareGuestBookingRequestSchema>;

export const ConfirmBookingRequestSchema = z
  .object({
    pendingId: z.string().min(20).max(100),
    finalTranscript: z.string().trim().min(1).max(400),
    decision: z.enum(["approve", "decline", "change", "unclear"]),
    language: LanguageSchema,
  })
  .strict();

export const CancelBookingRequestSchema = z
  .object({
    pendingId: z.string().min(20).max(100),
    language: LanguageSchema,
  })
  .strict();

export type PrepareBookingRequest = z.infer<typeof PrepareBookingRequestSchema>;
export type ConfirmBookingRequest = z.infer<typeof ConfirmBookingRequestSchema>;
export type CancelBookingRequest = z.infer<typeof CancelBookingRequestSchema>;
