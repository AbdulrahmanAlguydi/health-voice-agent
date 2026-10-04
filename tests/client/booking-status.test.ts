import { expect, it } from "vitest";
import { contradictsBookingStatus } from "../../src/client/agent/bookingStatus";

it.each(["تمام حجزنا الموعد، عندك رقم مريض؟", "حجزت لك موعد بكرة", "تم الحجز", "Your appointment is booked."])("rejects a completed-booking claim before saving: %s", (text) => {
  expect(contradictsBookingStatus(text, false)).toBe(true);
});
it.each(["أحجزه لك؟", "الموعد متاح، أأكد لك الحجز؟", "ما حجزت لك شيء", "Your appointment has not been booked."])("allows unsaved questions and explicit negative status: %s", (text) => {
  expect(contradictsBookingStatus(text, false)).toBe(false);
});
it.each(["تم، حجزك مؤكد. أأكد لك الحجز؟", "Your appointment is booked. Should I confirm the booking?"])("does not ask for booking approval again after saving: %s", (text) => {
  expect(contradictsBookingStatus(text, true)).toBe(true);
});
it("allows a successful receipt and a normal offer of further help", () => {
  expect(contradictsBookingStatus("حجزت لك الموعد. تحتاج شيء ثاني؟", true)).toBe(false);
  expect(contradictsBookingStatus("أكيد، تم الحجز. موعدك بكرة.", true)).toBe(false);
});
