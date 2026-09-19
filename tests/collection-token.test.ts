import { expect, test } from 'bun:test';
import { readCollectionToken } from '../lib/collection-token';

const token = 'a'.repeat(43);

test('accepts one exact token from the URL fragment', () => {
  expect(readCollectionToken(`#token=${token}`)).toBe(token);
  for (const hash of [
    '',
    `#token=${'a'.repeat(42)}`,
    `#token=${token}&extra=value`,
    `#token=${token}&token=${token}`,
  ]) {
    expect(readCollectionToken(hash)).toBeNull();
  }
});
