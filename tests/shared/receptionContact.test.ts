import { describe, expect, it } from 'vitest';
import { captureReceptionContact as capture, confirmReceptionContact as confirm, createReceptionContact as create, isReceptionContactValid } from '../../src/shared/receptionContact';

describe('reception contact capture', () => {
  it.each([['١', '1'], ['one one zero', '110'], ['double five triple zero', '55000'], ['صفر خمسة خمسة ثلاثة', '0553'], ['خمسة وخمسين', '55'], ['+966 55 123 4567', '0551234567']])('preserves literal digits in %s', (rawText, digits) => {
    expect(capture(create(), { mode: 'append', rawText }).digits).toBe(digits);
  });
  it('appends short chunks and keeps the original dictation', () => {
    const first = capture(create(), { mode: 'append', rawText: 'صفر خمسة' });
    const second = capture(first, { mode: 'append', rawText: '٥٥١٢٣٤٥٦' });
    expect(second.digits).toBe('0555123456');
    expect(second.rawChunks).toEqual(['صفر خمسة', '٥٥١٢٣٤٥٦']);
    expect(isReceptionContactValid(second)).toBe(false);
    expect(isReceptionContactValid(confirm(second, { contactVersion: second.version, decision: 'accept' }))).toBe(true);
  });
  it('replaces a partial with a complete number and never concatenates complete numbers', () => {
    const first = capture(create(), { mode: 'append', rawText: '05' });
    const second = capture(first, { mode: 'append', rawText: '0551234567' });
    expect(second.digits).toBe('0551234567');
    expect(capture(second, { mode: 'append', rawText: '0569876543' }).digits).toBe('0569876543');
  });
  it('invalidates confirmation on correction and rejects stale confirmation', () => {
    const known = create('0551234567');
    const updated = capture(known, { mode: 'correct', rawText: '9', startIndex: 3, deleteCount: 1 });
    expect(updated.digits).toBe('0559234567');
    expect(updated.confirmedVersion).toBeUndefined();
    expect(isReceptionContactValid(confirm(updated, { contactVersion: known.version, decision: 'accept' }))).toBe(false);
    expect(isReceptionContactValid(confirm(updated, { contactVersion: updated.version, decision: 'accept' }))).toBe(true);
  });
  it('never pads an invalid count or silently interprets unknown words', () => {
    expect(capture(create(), { mode: 'replace', rawText: '123' })).toMatchObject({ digits: '123', issue: 'invalid_digit_count' });
    expect(capture(create(), { mode: 'replace', rawText: '05 banana 12345678' })).toMatchObject({ digits: '', issue: 'unrecognized_digits' });
    expect(capture(create('0551234567'), { mode: 'correct', rawText: '3', startIndex: 99, deleteCount: 1 }).digits).toBe('0551234567');
  });
  it('restarts capture and decline removes confirmation', () => {
    expect(capture(create('0551234567'), { mode: 'restart' })).toMatchObject({ digits: '', rawChunks: [], source: 'dictated' });
    expect(isReceptionContactValid(confirm(create('0551234567'), { contactVersion: 1, decision: 'decline' }))).toBe(false);
  });
});
import { captureReceptionContact as captureGrouped, createReceptionContact as createGrouped } from '../../src/shared/receptionContact';
import { it as groupedIt, expect as groupedExpect } from 'vitest';

groupedIt.each([
  ['ثمانية أصفار', '00000000'],
  ['تسعتين', '99'],
  ['صفر خمسمية ستة واحد أربعة خمسة ثمانية أربعة', '0500614584'],
])('preserves explicit Arabic repetition/group %s', (rawText, digits) => {
  groupedExpect(captureGrouped(createGrouped(), {mode:'append',rawText}).digits).toBe(digits);
});
groupedIt('appends eight explicit zeros to a supplied Saudi prefix without padding', () => {
  const prefix=captureGrouped(createGrouped(),{mode:'append',rawText:'صفر خمسة'});
  groupedExpect(captureGrouped(prefix,{mode:'append',rawText:'ثمانية أصفار'})).toMatchObject({digits:'0500000000',issue:undefined});
});
