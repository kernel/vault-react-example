import { expect, test } from 'bun:test';
import { readCaptureToken } from '../lib/capture-token';

const token = `s36utp6h7ycc1bpm6pyv1g2p.${'a'.repeat(43)}`;

test('reads a single capture token from the fragment', () => {
  expect(readCaptureToken(`#token=${token}`)).toBe(token);
  expect(readCaptureToken(`token=${token}`)).toBe(token);
});

test('rejects malformed, repeated, or extra fragment parameters', () => {
  for (const hash of [
    '',
    '#token=',
    `#token=${'a'.repeat(43)}`,
    `#token=ABC.${'a'.repeat(43)}`,
    `#token=${token}x`,
    `#token=${token}&token=${token}`,
    `#token=${token}&next=/`,
  ]) {
    expect(readCaptureToken(hash)).toBeNull();
  }
});
