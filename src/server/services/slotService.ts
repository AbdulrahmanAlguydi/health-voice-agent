import type Database from "better-sqlite3";
import type {
  AvailableSlotsRequest,
  AvailableSlotsResult,
  Language,
  SlotSummary,
} from "../../shared/contracts";
import { listSlotsForDoctor } from "../repositories/slotRepository";
import { appointmentLabels } from "../../shared/appointmentLabels";
import { resolveDoctorIdentifier, toDoctorSummary } from "./doctorService";

function asSlotSummary(slot: { id: string; startsAtUtc: string }, language: Language, now: Date): SlotSummary {
  return {
    slotId: slot.id,
    startsAtUtc: slot.startsAtUtc,
    ...appointmentLabels(slot.startsAtUtc, language, now),
  };
}

function getSaudiDayRange(date: string) {
  const start = new Date(`${date}T00:00:00.000+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function getAvailableSlots(db: Database.Database, request: AvailableSlotsRequest, currentDate = new Date()): AvailableSlotsResult {
  const resolved = resolveDoctorIdentifier(db, request.doctorIdentifier);
  if (resolved.status === "not_found") {
    return {
      status: "not_found",
      responseText:
        request.language === "ar"
          ? "ما لقيت الطبيب عندنا. تقدر تعطيني اسمه أو تخصصه؟"
          : "I couldn't find that doctor in the directory. Could you give me the name or specialty?",
    };
  }
  if (resolved.status === "ambiguous") {
    const candidates = resolved.doctors.map((doctor) => toDoctorSummary(doctor, request.language));
    const names = candidates.map((candidate) => candidate.name);
    return {
      status: "ambiguous",
      candidates,
      responseText:
        request.language === "ar"
          ? `الاسم هذا يطابق أكثر من طبيب: ${names.join("، ")}. أي واحد تقصد؟`
          : `That name matches more than one doctor: ${names.join(", ")}. Which one did you mean?`,
    };
  }

  const doctor = toDoctorSummary(resolved.doctor, request.language);
  const allSlots = listSlotsForDoctor(db, resolved.doctor.id);
  const now = currentDate.toISOString();
  const futureSlots = allSlots.filter((slot) => slot.startsAtUtc >= now);
  const available = futureSlots.filter((slot) => slot.status === "available");
  const requestedDay = request.requestedDate ? getSaudiDayRange(request.requestedDate) : undefined;
  const daySlots = requestedDay
    ? futureSlots.filter((slot) => slot.startsAtUtc >= requestedDay.start && slot.startsAtUtc < requestedDay.end)
    : available;
  const dayAvailable = daySlots.filter((slot) => slot.status === "available");

  if (dayAvailable.length > 0 || (!request.requestedDate && available.length > 0)) {
    const slots = (request.requestedDate ? dayAvailable : available).slice(0, 6).map((slot) => asSlotSummary(slot, request.language, currentDate));
    const dates = slots.map((slot) => request.dateStyle === "hijri" ? slot.spokenHijriDateTime : request.dateStyle === "gregorian" ? slot.spokenDateTime : slot.relativeDateTime);
    return {
      status: "ok",
      doctor,
      slots,
      responseText:
        request.language === "ar"
          ? `هذي أقرب المواعيد المتاحة مع ${doctor.name}: ${dates.join("، ")}. أي موعد يناسبك؟`
          : `The available times with ${doctor.name} are ${dates.join(", ")}. Which works for you?`,
    };
  }

  const alternatives = available.slice(0, 3).map((slot) => asSlotSummary(slot, request.language, currentDate));
  const alternativeText = alternatives.map((slot) => request.dateStyle === "hijri" ? slot.spokenHijriDateTime : request.dateStyle === "gregorian" ? slot.spokenDateTime : slot.relativeDateTime).join(request.language === "ar" ? "، " : ", ");
  return {
    status: "unavailable",
    doctor,
    slots: [],
    alternatives,
    responseText:
      request.language === "ar"
        ? alternatives.length > 0
          ? `ما فيه موعد متاح بهاليوم. أقدر أعرض لك هالمواعيد البديلة: ${alternativeText}. أي موعد يناسبك؟`
          : "ما فيه موعد متاح بهاليوم. تبي أشيك لك على يوم ثاني؟"
        : alternatives.length > 0
          ? `I don't see an available appointment that day. I can offer these alternatives: ${alternativeText}. Would one work?`
          : "I don't see an available appointment that day. Would you like me to check another date?",
  };
}
