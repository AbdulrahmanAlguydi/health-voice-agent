import type { ReceptionContact } from './reception';
import { normalizeSimulatedCallingNumber } from './simulatedCallingNumber';

export type ReceptionContactCapture = { mode: 'append' | 'replace' | 'restart' | 'correct'; rawText?: string; startIndex?: number; deleteCount?: number };
const words: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  صفر: '0', واحد: '1', اثنين: '2', اثنان: '2', اتنين: '2', ثلاثة: '3', ثلاثه: '3', اربعة: '4', اربعه: '4', خمسة: '5', خمسه: '5', ستة: '6', سته: '6', سبعة: '7', سبعه: '7', ثمانية: '8', ثمانيه: '8', تسعة: '9', تسعه: '9',
};
const groups: Record<string, string> = { عشرة: '10', عشره: '10', عشرين: '20', ثلاثين: '30', اربعين: '40', خمسين: '50', ستين: '60', سبعين: '70', ثمانين: '80', تسعين: '90' };
const hundreds: Record<string, string> = { مية:'100', مئة:'100', ميه:'100', مئتين:'200', ميتين:'200', ثلاثمية:'300', ثلاثمئة:'300', اربعمية:'400', اربعمئة:'400', خمسمية:'500', خمسمئة:'500', ستمية:'600', ستمئة:'600', سبعمية:'700', سبعمئة:'700', ثمانمية:'800', ثمانمئة:'800', تسعمية:'900', تسعمئة:'900' };
const doubles: Record<string,string> = { صفرين:'00', واحدين:'11', اثنينين:'22', ثلاثتين:'33', اربعتين:'44', خمستين:'55', ستتين:'66', سبعتين:'77', ثمانيتين:'88', تسعتين:'99' };
function extract(raw: string): string | undefined {
  const normalized = raw.toLowerCase().replace(/[٠-٩۰-۹]/g, d => String(d.charCodeAt(0) - (d >= '۰' ? 0x6f0 : 0x660))).replace(/[أإآ]/g, 'ا').replace(/[ً-ٟ]/g, '').replace(/[(),،.\-]/g, ' ').trim();
  if (!normalized) return '';
  const tokens = normalized.replace(/(\d)\s*\+/, '$1 +').split(/\s+/);
  let digits = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (words[token] && ['اصفار','صفرات','zeros'].includes(tokens[i+1])) { digits += '0'.repeat(Number(words[token])); i++; continue; }
    if (doubles[token]) { digits += doubles[token]; continue; }
    if (hundreds[token]) { digits += hundreds[token]; continue; }
    if ((token === 'double' || token === 'triple') && words[tokens[i + 1]] !== undefined) { digits += words[tokens[++i]].repeat(token === 'double' ? 2 : 3); continue; }
    const next = tokens[i + 1]?.replace(/^و/, '');
    if (words[token] && groups[next] && groups[next] !== '10') { digits += `${groups[next][0]}${words[token]}`; i++; continue; }
    if (/^\+?\d+$/.test(token)) digits += token;
    else if (words[token] !== undefined) digits += words[token];
    else if (groups[token]) digits += groups[token];
    else return undefined;
  }
  if (digits.startsWith('+966')) digits = `0${digits.slice(4)}`;
  return digits;
}
function issue(digits: string): string | undefined {
  if (!/^\d*$/.test(digits)) return 'invalid_digits';
  if (digits.length !== 10) return 'invalid_digit_count';
  if (!digits.startsWith('05')) return 'invalid_mobile_prefix';
  return undefined;
}
export function createReceptionContact(callingNumber?: string): ReceptionContact {
  if (!callingNumber?.trim()) return { rawChunks: [], digits: '', version: 0, source: 'dictated', issue: 'invalid_digit_count' };
  try {
    const digits = normalizeSimulatedCallingNumber(callingNumber)!;
    return { rawChunks: [callingNumber], digits, version: 1, confirmedVersion: 1, source: 'simulated_web_field' };
  } catch { return { rawChunks: [callingNumber], digits: '', version: 1, source: 'simulated_web_field', issue: 'invalid_digits' }; }
}
export function captureReceptionContact(contact: ReceptionContact, args: ReceptionContactCapture): ReceptionContact {
  const rawText = args.rawText ?? '';
  const parsed = extract(rawText);
  const base: ReceptionContact = { rawChunks: args.mode === 'restart' ? [] : [...contact.rawChunks, rawText], digits: contact.digits, version: contact.version + 1, source: 'dictated' };
  if (args.mode === 'restart') base.digits = '';
  else if (parsed === undefined) return { ...base, issue: 'unrecognized_digits' };
  else if (args.mode === 'correct') {
    const start = args.startIndex; const count = args.deleteCount;
    if (start === undefined || count === undefined || !Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > contact.digits.length) return { ...base, issue: 'invalid_correction_range' };
    base.digits = contact.digits.slice(0, start) + parsed + contact.digits.slice(start + count);
  } else base.digits = args.mode === 'replace' || issue(parsed) === undefined ? parsed : contact.digits + parsed;
  base.issue = issue(base.digits);
  return base;
}
export function confirmReceptionContact(contact: ReceptionContact, args: { contactVersion: number; decision: 'accept' | 'decline' | 'unclear' }): ReceptionContact {
  const { confirmedVersion: _confirmed, ...unconfirmed } = contact;
  if (args.contactVersion !== contact.version) return { ...unconfirmed, issue: 'stale_contact_version' };
  if (args.decision !== 'accept') return { ...unconfirmed, issue: args.decision === 'decline' ? 'contact_declined' : 'contact_unclear' };
  const invalid = issue(contact.digits);
  return invalid ? { ...unconfirmed, issue: invalid } : { ...unconfirmed, issue: undefined, confirmedVersion: contact.version };
}
export function isReceptionContactValid(contact: ReceptionContact): boolean {
  return issue(contact.digits) === undefined && !contact.issue && contact.confirmedVersion === contact.version;
}
