// Deployment files (SPEC 11, 12). Caddy's real log output is also checked in the
// local Docker Compose run; this test keeps the Caddyfile from drifting.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const caddyfile = fs.readFileSync(path.resolve(import.meta.dirname, '../Caddyfile'), 'utf8');

describe('Caddyfile access log', () => {
  const block = /format filter \{([\s\S]*?)\n\t\t\}/.exec(caddyfile)?.[1] ?? '';
  const deleted = new Set([...block.matchAll(/^\s*(\S+)\s+delete\s*$/gm)].map((m) => m[1]));

  it('keeps only method, path, status and duration of each request', () => {
    // Every field Caddy's access log writes, apart from those four (and the log line's own level/time/message).
    for (const field of [
      'request>remote_ip',
      'request>remote_port',
      'request>client_ip',
      'request>proto',
      'request>host',
      'request>headers',
      'request>tls',
      'bytes_read',
      'user_id',
      'size',
      'resp_headers',
    ]) {
      expect(deleted, field).toContain(field);
    }
    for (const kept of ['request>method', 'request>uri', 'status', 'duration']) expect(deleted, kept).not.toContain(kept);
    expect(block).toMatch(/request>uri regexp "\\\?\.\*\$" ""/);
  });
});

describe('Caddyfile error log (round 2)', () => {
  it('Caddy’s default logger (used for errors such as a 502) applies the same filter as the access log', () => {
    const global = /^\{\n([\s\S]*?)\n\}/m.exec(caddyfile)?.[1] ?? '';
    const block = /log default \{[\s\S]*?format filter \{([\s\S]*?)\n\t\t\}/.exec(global)?.[1] ?? '';
    const deleted = new Set([...block.matchAll(/^\s*(\S+)\s+delete\s*$/gm)].map((m) => m[1]));
    for (const field of ['request>remote_ip', 'request>remote_port', 'request>client_ip', 'request>proto', 'request>host', 'request>headers', 'request>tls', 'bytes_read', 'user_id', 'size', 'resp_headers']) {
      expect(deleted, field).toContain(field);
    }
    expect(block).toMatch(/request>uri regexp "\\\?\.\*\$" ""/);
  });
});

