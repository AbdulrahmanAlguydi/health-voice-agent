import { randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ConfirmBookingRequest, Language, PrepareBookingRequest, PrepareGuestBookingRequest } from "../../shared/contracts";
import { appointmentLabels } from "../../shared/appointmentLabels";
import { insertAppointment, bookingReferenceExists } from "../repositories/appointmentRepository";
import { findPatientById, insertGuestPatient } from "../repositories/patientRepository";
import { findSlotById, markBookedIfAvailable } from "../repositories/slotRepository";
import { seedDatabase } from "../db/seed";
import { resolveDoctorIdentifier, toDoctorSummary } from "./doctorService";

type PendingBooking = {
  patientId?: string;
  guest?: { fullName: string; mobileNumber: string };
  doctorId: string;
  slotId: string;
  expiresAt: number;
  calendar?: "gregorian" | "hijri";
};

type ServiceOptions = {
  now?: () => Date;
  confirmationTtlMs?: number;
};

function failure<TStatus extends string>(status: TStatus, language: Language, detail?: string): { status: TStatus; responseText: string } {
  const messages: Record<string, Record<Language, string>> = {
    invalid_patient: {
      en: "I couldn't verify that patient ID, so I haven't prepared a booking.",
      ar: "ما قدرت أتحقق من رقم المريض، فما جهزت الحجز.",
    },
    doctor_not_found: {
      en: "I couldn't find that doctor in the directory, so I haven't prepared a booking.",
      ar: "ما لقيت الطبيب عندنا، فما جهزت الحجز.",
    },
    ambiguous_doctor: {
      en: `That name matches more than one doctor${detail ? `: ${detail}` : ""}. Which one did you select?`,
      ar: `الاسم هذا يطابق أكثر من طبيب${detail ? `: ${detail}` : ""}. أي واحد تقصد؟`,
    },
    slot_unavailable: {
      en: "That appointment time is no longer available. I haven't booked anything.",
      ar: "هذا الموعد مو متاح الآن، وما حجزت لك شيء.",
    },
    not_confirmed: {
      en: "I haven't booked anything. We can change the time or leave it there.",
      ar: "ما حجزت لك شيء. نقدر نغيّر الموعد أو نوقف هنا.",
    },
    expired: {
      en: "That confirmation expired, so nothing was booked. We can check the time again.",
      ar: "انتهت مدة التأكيد، وما تم الحجز. نقدر نتحقق من الموعد مرة ثانية.",
    },
    not_found: {
      en: "I don't have an active booking confirmation for that request.",
      ar: "ما فيه طلب حجز نشط أقدر أكمله.",
    },
  };
  return { status, responseText: messages[status]?.[language] ?? messages.not_found[language] };
}

function makeBookingReference(db: Database.Database) {
  let reference = "";
  do {
    reference = `HA-${randomBytes(3).toString("hex").toUpperCase()}`;
  } while (bookingReferenceExists(db, reference));
  return reference;
}

function makeGuestPatientId(db: Database.Database) {
  let patientId = "";
  do {
    patientId = `G-${randomBytes(6).toString("hex").toUpperCase()}`;
  } while (findPatientById(db, patientId));
  return patientId;
}

class SlotUnavailableError extends Error {}

type ConfirmedBookingResult = {
  status: "confirmed";
  dateLabels?: { spokenDateTime: string; spokenHijriDateTime: string };
  appointment: { appointmentId: string; bookingReference: string; patientId: string; doctorId: string; slotId: string; startsAtUtc: string };
  responseText: string;
};

export class BookingService {
  private readonly pending = new Map<string, PendingBooking>();
  private readonly now: () => Date;
  private readonly confirmationTtlMs: number;

  constructor(
    private readonly db: Database.Database,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.confirmationTtlMs = options.confirmationTtlMs ?? 5 * 60 * 1000;
  }

  prepare(input: PrepareBookingRequest) {
    if (!findPatientById(this.db, input.patientId)) return failure("invalid_patient", input.language);
    return this.prepareResolved(input, { patientId: input.patientId });
  }

  prepareGuest(input: PrepareGuestBookingRequest) {
    return this.prepareResolved(input, {
      guest: { fullName: input.fullName, mobileNumber: input.mobileNumber },
    });
  }

  private prepareResolved(
    input: Pick<PrepareBookingRequest, "doctorIdentifier" | "slotId" | "language" | "calendar">,
    owner: Pick<PendingBooking, "patientId" | "guest">,
  ) {
    const resolution = resolveDoctorIdentifier(this.db, input.doctorIdentifier);
    if (resolution.status === "not_found") return failure("doctor_not_found", input.language);
    if (resolution.status === "ambiguous") {
      const names = resolution.doctors.map((doctor) =>
        input.language === "ar" ? doctor.nameAr : doctor.nameEn,
      );
      return failure("ambiguous_doctor", input.language, names.join(input.language === "ar" ? "، " : ", "));
    }

    const slot = findSlotById(this.db, input.slotId);
    if (
      !slot ||
      slot.doctorId !== resolution.doctor.id ||
      slot.status !== "available" ||
      slot.startsAtUtc <= this.now().toISOString()
    ) {
      return failure("slot_unavailable", input.language);
    }

    const pendingId = randomBytes(32).toString("base64url");
    this.pending.set(pendingId, {
      ...owner,
      doctorId: resolution.doctor.id,
      slotId: slot.id,
      calendar: input.calendar,
      expiresAt: this.now().getTime() + this.confirmationTtlMs,
    });

    const doctor = toDoctorSummary(resolution.doctor, input.language);
    const labels = appointmentLabels(slot.startsAtUtc, input.language, this.now());
    const dateTime = input.calendar === "hijri" ? labels.spokenHijriDateTime : labels.spokenDateTime;
    return {
      status: "pending" as const,
      pendingId,
      doctor,
      slot: { slotId: slot.id, startsAtUtc: slot.startsAtUtc, spokenDateTime: labels.spokenDateTime, spokenHijriDateTime: labels.spokenHijriDateTime },
      responseText:
        owner.guest
          ? input.language === "ar"
            ? `بس أتأكد: الموعد مع ${doctor.name} يوم ${dateTime}، والاسم ${owner.guest.fullName}، ورقم الجوال ${owner.guest.mobileNumber}. أأكد الحجز؟`
            : `Just to confirm: ${owner.guest.fullName}, your appointment with ${doctor.name} is ${dateTime}, and your mobile number is ${owner.guest.mobileNumber}. Should I confirm the booking?`
          : input.language === "ar"
            ? `الموعد متاح مع ${doctor.name} يوم ${dateTime}. أحجزه لك؟`
            : `I have ${doctor.name} available at ${dateTime}. Would you like me to book this appointment?`,
    };
  }

  confirm(input: ConfirmBookingRequest) {
    // A response can be lost after commit. The same opaque request handle must
    // recover its saved result, even after restart, rather than create a new write.
    const saved = this.db.prepare("SELECT result_json FROM booking_results WHERE pending_id = ?")
      .get(input.pendingId) as { result_json: string } | undefined;
    if (saved) return input.decision === "approve"
      ? JSON.parse(saved.result_json) as ConfirmedBookingResult
      : failure("not_confirmed", input.language);
    const pending = this.pending.get(input.pendingId);
    if (!pending) return failure("not_found", input.language);
    if (pending.expiresAt <= this.now().getTime()) {
      this.pending.delete(input.pendingId);
      return failure("expired", input.language);
    }

    if (input.decision !== "approve") {
      this.pending.delete(input.pendingId);
      return failure("not_confirmed", input.language);
    }

    const commit = (candidate: PendingBooking) => {
      if (Boolean(candidate.patientId) === Boolean(candidate.guest)) throw new SlotUnavailableError();
      let patientId: string;
      if (candidate.guest) {
        patientId = makeGuestPatientId(this.db);
        insertGuestPatient(this.db, {
          patientId,
          fullName: candidate.guest.fullName,
          mobileNumber: candidate.guest.mobileNumber,
        });
      } else if (candidate.patientId && findPatientById(this.db, candidate.patientId)) {
        patientId = candidate.patientId;
      } else {
        throw new SlotUnavailableError();
      }
      const doctor = this.db.prepare("SELECT id FROM doctors WHERE id = ?").get(candidate.doctorId) as
        | { id: string }
        | undefined;
      const slot = findSlotById(this.db, candidate.slotId);
      if (
        !doctor ||
        !slot ||
        slot.doctorId !== candidate.doctorId ||
        slot.status !== "available" ||
        slot.startsAtUtc <= this.now().toISOString()
      ) {
        throw new SlotUnavailableError();
      }
      if (markBookedIfAvailable(this.db, candidate.slotId) !== 1) throw new SlotUnavailableError();

      const appointment = insertAppointment(this.db, {
        id: randomUUID(),
        bookingReference: makeBookingReference(this.db),
        patientId,
        doctorId: candidate.doctorId,
        slotId: candidate.slotId,
        createdAtUtc: this.now().toISOString(),
      });
      return { appointment, patientId };
    };

    try {
      const commitWithResult = this.db.transaction(() => {
        const { appointment, patientId } = commit(pending);
        const doctor = resolveDoctorIdentifier(this.db, pending.doctorId);
        const doctorName = doctor.status === "matched"
          ? input.language === "ar" ? doctor.doctor.nameAr : doctor.doctor.nameEn
          : "";
        const slot = findSlotById(this.db, pending.slotId);
        const labels = slot ? appointmentLabels(slot.startsAtUtc, input.language, this.now()) : undefined;
        const dateTime = (pending.calendar === "hijri" ? labels?.spokenHijriDateTime : labels?.spokenDateTime) ?? "";
        const result: ConfirmedBookingResult = {
          status: "confirmed" as const,
          dateLabels: labels ? { spokenDateTime: labels.spokenDateTime, spokenHijriDateTime: labels.spokenHijriDateTime } : undefined,
          appointment: {
            appointmentId: appointment.id,
            bookingReference: appointment.bookingReference,
            patientId,
            doctorId: appointment.doctorId,
            slotId: appointment.slotId,
            startsAtUtc: slot?.startsAtUtc ?? "",
          },
          responseText: pending.guest
            ? input.language === "ar"
              ? `حجزت لك موعد مع ${doctorName} يوم ${dateTime}. رقم المريض: ${patientId}. رقم الحجز: ${appointment.bookingReference}.`
              : `Your appointment with ${doctorName} is booked for ${dateTime}. Your patient ID is ${patientId}. Your booking reference is ${appointment.bookingReference}.`
            : input.language === "ar"
              ? `حجزت لك موعد مع ${doctorName} يوم ${dateTime}. رقم الحجز: ${appointment.bookingReference}.`
              : `Your appointment with ${doctorName} is booked for ${dateTime}. Your reference is ${appointment.bookingReference}.`,
        };
        this.db.prepare("INSERT INTO booking_results (pending_id, appointment_id, result_json) VALUES (?, ?, ?)")
          .run(input.pendingId, appointment.id, JSON.stringify(result));
        return result;
      });
      const result = commitWithResult.immediate();
      this.pending.delete(input.pendingId);
      return result;
    } catch (error) {
      this.pending.delete(input.pendingId);
      if (error instanceof SlotUnavailableError) return failure("slot_unavailable", input.language);
      throw error;
    }
  }

  cancel(pendingId: string, language: Language) {
    if (!this.pending.delete(pendingId)) return failure("not_found", language);
    return {
      status: "cancelled" as const,
      responseText: language === "ar" ? "ألغيت الطلب المعلّق، وما صار أي حجز." : "The pending request was cancelled; nothing was booked.",
    };
  }
}

export function resetDemoDatabase(db: Database.Database) {
  const reset = db.transaction(() => {
    db.prepare("DELETE FROM appointments").run();
    db.prepare("DELETE FROM patients WHERE patient_id LIKE 'G-%'").run();
    db.prepare("UPDATE slots SET status = seed_status").run();
  });
  reset.immediate();
  seedDatabase(db);
}
