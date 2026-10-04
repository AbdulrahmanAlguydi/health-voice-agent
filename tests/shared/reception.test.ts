import { expect, it } from 'vitest';
import { receptionCommandSchema, receptionMediaEventSchema } from '../../src/shared/reception';

const context = { connectionId: 'c', inputTurnId: 't', inputSequence: 2, eventSequence: 4, inputStartedEventSequence: 3, source: 'text', attribution: 'known' };
it('rejects missing ordering metadata and invalid carrier sequence', () => {
  expect(receptionCommandSchema.safeParse({ eventId: 'e', expectedVersion: 1, tool: 'clinic_information', args: {}, context }).success).toBe(true);
  expect(receptionCommandSchema.safeParse({ eventId: 'e', expectedVersion: -1, tool: 'clinic_information', args: {}, context }).success).toBe(false);
  expect(receptionCommandSchema.safeParse({ eventId: 'e', expectedVersion: 1, tool: 'clinic_information', args: {}, context: { ...context, inputStartedEventSequence: undefined } }).success).toBe(false);
});
it('validates audio and text exposure events without a domain revision', () => {
  const event = { eventId: 'e', connectionId: 'c', outputId: 'o', inputSequence: 1, eventSequence: 2, medium: 'text', exposure: 'started', offerIds: ['offer'] };
  expect(receptionMediaEventSchema.safeParse(event).success).toBe(true);
  expect(receptionMediaEventSchema.safeParse({ ...event, exposure: 'heard' }).success).toBe(false);
});
