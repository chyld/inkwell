// A 401 belongs to the sign-in it was sent under (review round 2).
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, newAuthEpoch, setExpectedUser, setUnauthorizedHandler } from '../../src/web/api.js';

describe('api 401 handling', () => {
  it('a 401 for a request sent before the current sign-in does not sign the new user out', async () => {
    let answer: (r: Response) => void = () => {};
    globalThis.fetch = vi.fn(() => new Promise<Response>((r) => (answer = r))) as any;
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const old = api('GET', '/notes').catch((e) => e);
    newAuthEpoch(); // someone signed in meanwhile
    answer(new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Please sign in.' } }), { status: 401 }));
    expect(await old).toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
    // A 401 for a request made under the current sign-in still shows the sign-in page.
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as any;
    await api('GET', '/notes').catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('expected user (round 3)', () => {
  it('every request, uploads included, says which user this tab is signed in as', async () => {
    const seen: (string | null)[] = [];
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      seen.push(new Headers(init.headers).get('x-notes-user'));
      return new Response('{}', { status: 200 });
    }) as any;
    setExpectedUser('u1');
    await api('GET', '/notes');
    await api('POST', '/notes', {});
    await api('POST', '/images', undefined, { form: new FormData() });
    setExpectedUser(null);
    await api('GET', '/me');
    expect(seen).toEqual(['u1', 'u1', 'u1', null]);
  });

  it('a wrong_user 401 shows the sign-in page', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    setExpectedUser('u1');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'wrong_user', message: 'x' } }), { status: 401 })) as any;
    await api('POST', '/notes', {}).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    setExpectedUser(null);
  });
});

