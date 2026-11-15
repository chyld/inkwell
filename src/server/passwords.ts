import crypto from 'node:crypto';

// Argon2id, version 1.3 (0x13 = 19), 64 MiB, 3 iterations, parallelism 1,
// 16-byte salt, 32-byte output, in the standard PHC encoded form.
const PARAMS = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 } as const;
export const MIN_PASSWORD_LENGTH = 12;

function b64(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '');
}

function argon2id(password: string, salt: Buffer, p: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.argon2('argon2id', { message: password, nonce: salt, ...p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await argon2id(password, salt, PARAMS);
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const ENCODED_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  const m = ENCODED_RE.exec(encoded);
  if (!m) return false;
  const salt = Buffer.from(m[4], 'base64');
  const expected = Buffer.from(m[5], 'base64');
  const actual = await argon2id(password, salt, {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

let dummy: string | null = null;
/** Spend the same time as a real check, for unknown usernames. */
export async function dummyVerify(password: string): Promise<void> {
  if (!dummy) dummy = await hashPassword('not-a-real-password-placeholder');
  await verifyPassword(dummy, password);
}

export function checkPasswordRules(password: string): string | null {
  if ([...password].length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 1024) return 'Password is too long.';
  return null;
}

export function generatePassword(): string {
  // 20 characters from an unambiguous alphabet (~115 bits).
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 20; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}
