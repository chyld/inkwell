// Note addresses: /n/<22-character base62 form of the note's UUID>.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeNoteId, encodeNoteId, NOTE_ID_LENGTH, notePath } from '../src/shared/noteAddress.js';

describe('note address encoding', () => {
  it('round-trips random UUIDs, always 22 base62 characters', () => {
    for (let i = 0; i < 2000; i++) {
      const u = randomUUID();
      const id = encodeNoteId(u);
      expect(id).toMatch(/^[0-9A-Za-z]{22}$/);
      expect(decodeNoteId(id)).toBe(u);
    }
    expect(NOTE_ID_LENGTH).toBe(22);
  });

  it('handles the extremes: all zeros and all ones', () => {
    const zero = '00000000-0000-0000-0000-000000000000';
    const ones = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    expect(encodeNoteId(zero)).toBe('0'.repeat(22));
    expect(decodeNoteId('0'.repeat(22))).toBe(zero);
    expect(encodeNoteId(ones)).toBe('7n42DGM5Tflk9n8mt7Fhc7'); // 2^128 - 1
    expect(decodeNoteId('7n42DGM5Tflk9n8mt7Fhc7')).toBe(ones);
  });

  it('is a known, fixed mapping (not just self-consistent)', () => {
    expect(encodeNoteId('00000000-0000-0000-0000-000000000001')).toBe('0'.repeat(21) + '1');
    expect(encodeNoteId('00000000-0000-0000-0000-00000000003d')).toBe('0'.repeat(21) + 'z'); // 61
    expect(encodeNoteId('00000000-0000-0000-0000-00000000003e')).toBe('0'.repeat(20) + '10'); // 62
    expect(notePath('00000000-0000-0000-0000-00000000000a')).toBe('/n/' + '0'.repeat(21) + 'A');
  });

  it('has exactly one canonical form per UUID: upper-case input gives the same id, output is lower-case', () => {
    const u = randomUUID();
    expect(encodeNoteId(u.toUpperCase())).toBe(encodeNoteId(u));
    expect(decodeNoteId(encodeNoteId(u.toUpperCase()))).toBe(u);
    // Without padding, or padded further, the same number is not accepted: only the 22-character form is.
    const id = encodeNoteId('00000000-0000-0000-0000-000000000001');
    expect(decodeNoteId(id.replace(/^0+/, ''))).toBeNull();
    expect(decodeNoteId('0' + id)).toBeNull();
  });

  it('rejects wrong length, bad characters and values above 2^128 - 1', () => {
    const id = encodeNoteId(randomUUID());
    for (const bad of ['', id.slice(1), id + 'a', id.slice(0, 21) + '-', id.slice(0, 21) + '_', id.slice(0, 21) + ' ', id.slice(0, 21) + 'é', ' '.repeat(22)]) {
      expect(decodeNoteId(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(decodeNoteId('7n42DGM5Tflk9n8mt7Fhc8')).toBeNull(); // 2^128
    expect(decodeNoteId('zzzzzzzzzzzzzzzzzzzzzz')).toBeNull();
    expect(decodeNoteId(undefined as unknown as string)).toBeNull();
    for (const bad of ['not-a-uuid', '', '123', '00000000-0000-0000-0000-00000000000g', '000000000000000000000000000000000']) expect(() => encodeNoteId(bad)).toThrow();
  });
});
