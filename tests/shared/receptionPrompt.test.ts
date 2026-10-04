import { expect, it } from 'vitest';
import { buildReceptionSystemInstruction, createReceptionLiveConfig, receptionTools } from '../../src/shared/receptionPrompt';
import type { ReceptionSnapshot } from '../../src/shared/reception';
it('declares only resource functions and keeps transport metadata out of model arguments', () => {
  expect(receptionTools.map(tool => tool.name)).toEqual(['clinic_information', 'find_available_slots', 'set_booking_details', 'capture_contact', 'confirm_contact', 'accept_offer', 'commit_request', 'get_operation', 'find_my_appointments', 'select_appointment', 'record_followup', 'set_emergency', 'end_session']);
  for (const tool of receptionTools) {
    const schema = tool.parametersJsonSchema as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.eventId).toBeUndefined();
    expect(schema.properties.expectedVersion).toBeUndefined();
  }
  const config = createReceptionLiveConfig('Kore');
  expect(config.tools).toEqual([{ functionDeclarations: receptionTools }]);
  expect(config.responseModalities).toEqual(['AUDIO']);
});
it('gives accept_offer result-specific guidance for accepted selections with incomplete contact', () => {
  const description = receptionTools.find(tool => tool.name === 'accept_offer')?.description ?? '';
  expect(description).toContain('invalid_contact');
  expect(description).toContain('needs_details');
  expect(description).toContain('offerAccepted');
  expect(description).toContain('bookingStatus=not_booked');
  expect(description).toContain('appointmentSaved=false');
  expect(description).toContain('slotReserved=false');
  expect(description).toContain('capacityHeld=false');
  expect(description).toContain('Do not use fixed wording');
});
it('keeps mixed or unrelated replies from advancing offer consent', () => {
  const description = receptionTools.find(tool => tool.name === 'accept_offer')?.description ?? '';
  expect(description).toContain('mixed or unclear');
  expect(description).toContain('name or phone number alone');
  expect(description).toContain('wait for a new caller turn');
  expect(description).toContain('doctor, exact date and time');
  expect(description).toContain('do not collect details');
  expect(description).toContain('or claim success');
});
it('uses database availability windows for discovery and checks one exact time before consent',()=>{
  const availability=receptionTools.find(tool=>tool.name==='find_available_slots')?.description??'';
  const accept=receptionTools.find(tool=>tool.name==='accept_offer')?.description??'';
  const prompt=buildReceptionSystemInstruction();
  expect(availability).toContain('availabilityWindows');
  expect(availability).toContain('exactTime');
  expect(availability).toContain('range is not a booking offer');
  expect(availability).toContain('exact_time_requires_single_date');
  expect(availability).toContain('ask for the specific date');
  expect(availability).toContain('return the matching offer if available');
  expect(accept).toContain('Never accept a time range');
  expect(prompt).toContain('startTime');
  expect(prompt).toContain('lastStartTime');
  expect(prompt).toContain('only a specific exact-time offer can be accepted');
});
it('keeps the spoken style relaxed and professional without weakening booking guidance',()=>{
  const prompt=buildReceptionSystemInstruction();
  expect(prompt).toContain('أسلوبك خفيف وقريب من الكلام اليومي');
  expect(prompt).toContain('من غير مبالغة في الرسمية أو المزح');
  expect(prompt).toContain('الموافقة على نطاق عام ما تعني اختيار موعد محدد');
});
it('injects current server clock and data without reconstructing stale transcript history', () => {
  const snapshot: ReceptionSnapshot = { sessionId: 's', version: 2, status: 'active', clock: { nowIso: '2031-08-19T09:00:00Z', localDate: '2031-08-19', timeZone: 'Asia/Riyadh' }, directory: [], clinic: { nameEn: 'Synthetic Clinic' }, contact: { rawChunks: ['raw private dictation'], digits: '0551234567', version: 1, confirmedVersion: 1, source: 'simulated_web_field' }, offers: [], operations: [] };
  const prompt = buildReceptionSystemInstruction(snapshot);
  const context = JSON.parse(prompt.split('SERVER RECEPTION CONTEXT\n')[1]);
  expect(context.clock.localDate).toBe('2031-08-19');
  expect(context.contact).toEqual({ digits: '0551234567', version: 1, confirmedVersion: 1, source: 'simulated_web_field' });
  expect(context.contact.rawChunks).toBeUndefined();
});
