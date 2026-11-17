#!/usr/bin/env node
// The `notes` command-line tool (SPEC 9). Uses the same data-access module as
// the web server and opens the SQLite file directly.
import fs from 'node:fs';
import { loadConfig, ConfigError, type Config } from '../server/config.js';
import { openDatabase, migrate, MigrationError } from '../server/db.js';
import { Store, checkUsername, normalizeUsername } from '../server/store.js';
import { AppError } from '../server/errors.js';
import { checkPasswordRules, generatePassword } from '../server/passwords.js';
import { clientInstructions } from '../server/clients.js';

const USAGE = `Usage: notes <command>    (administers the Inkwell app on this server)

  user add <username> [--generate]   Create a user and their Inbox (prompts for a password twice,
                                     or --generate prints a random one once)
  user list                          List users
  user passwd <username>             Set a new password; ends that user's sessions
  user disable <username>            Block sign-in; ends sessions; the user's agents get 401
  user enable <username>             Allow sign-in again
  user delete <username>             Delete the user and everything they own (asks to type the username)
  agent add <username> <agent-name>  Create an agent and print its token once
  agent list [<username>]            List agents
  agent revoke <username> <agent-name>  Revoke an agent's token at once (its notes stay)
  data copy <dir>                    Write a consistent copy of the database and image files to the new directory <dir>
`;

class UsageError extends Error {}

// ---- input --------------------------------------------------------------

let pipedLines: string[] | null = null;
function readPipedLine(): string | null {
  if (pipedLines === null) {
    let data = '';
    try {
      data = fs.readFileSync(0, 'utf8');
    } catch {
      data = '';
    }
    pipedLines = data.split(/\r?\n/);
  }
  return pipedLines.length ? pipedLines.shift()! : null;
}

function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function readVisible(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk: string) => {
      buf += chunk;
      const i = buf.search(/\r?\n/);
      if (i !== -1) {
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        resolve(buf.slice(0, i));
      }
    };
    process.stdin.on('data', onData);
  });
}

async function ask(prompt: string, hidden: boolean): Promise<string> {
  if (process.stdin.isTTY) return hidden ? readHidden(prompt) : readVisible(prompt);
  const line = readPipedLine();
  if (line === null) throw new UsageError('No input: expected a line on standard input.');
  return line;
}

async function askNewPassword(): Promise<string> {
  const a = await ask('New password (at least 12 characters): ', true);
  const err = checkPasswordRules(a);
  if (err) throw new UsageError(err);
  const b = await ask('Type it again: ', true);
  if (a !== b) throw new UsageError('The two passwords do not match. Nothing was changed.');
  return a;
}

// ---- output -------------------------------------------------------------

function table(rows: string[][]) {
  if (rows.length === 0) return;
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const date = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '-');

// ---- commands -----------------------------------------------------------

async function run(argv: string[], config: Config, store: Store): Promise<void> {
  const [area, cmd, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith('--'));
  const args = rest.filter((a) => !a.startsWith('--'));
  const need = (n: number, usage: string) => {
    if (args.length !== n) throw new UsageError(`Usage: notes ${usage}`);
  };
  const key = `${area ?? ''} ${cmd ?? ''}`;
  switch (key) {
    case 'user add': {
      need(1, 'user add <username> [--generate]');
      const username = normalizeUsername(args[0]);
      const bad = checkUsername(username);
      if (bad) throw new UsageError(bad);
      if (store.identity.getUserByUsername(username)) throw new UsageError(`User "${username}" already exists.`);
      const generate = flags.includes('--generate');
      const password = generate ? generatePassword() : await askNewPassword();
      await store.identity.createUser(username, password);
      console.log(`Created user "${username}" with an Inbox folder.`);
      if (generate) console.log(`Password (shown only once): ${password}`);
      return;
    }
    case 'user list': {
      need(0, 'user list');
      const users = store.identity.listUsers();
      if (users.length === 0) return void console.log('No users yet. Create one with: notes user add <username>');
      table([
        ['USERNAME', 'CREATED', 'STATUS', 'NOTES', 'STORAGE', 'AGENTS'],
        ...users.map((u) => [u.username, date(u.createdAt), u.disabled ? 'disabled' : 'enabled', String(u.noteCount), bytes(u.storageUsed), String(u.agentCount)]),
      ]);
      return;
    }
    case 'user passwd': {
      need(1, 'user passwd <username>');
      store.identity.requireUser(args[0]);
      const password = await askNewPassword();
      await store.identity.setPassword(args[0], password);
      console.log(`Password changed for "${normalizeUsername(args[0])}". All of their sessions have ended.`);
      return;
    }
    case 'user disable':
    case 'user enable': {
      need(1, `user ${cmd} <username>`);
      store.identity.setDisabled(args[0], cmd === 'disable');
      console.log(
        cmd === 'disable'
          ? `Disabled "${normalizeUsername(args[0])}": sessions ended, sign-in blocked, agent tokens refused.`
          : `Enabled "${normalizeUsername(args[0])}".`,
      );
      return;
    }
    case 'user delete': {
      need(1, 'user delete <username>');
      const user = store.identity.requireUser(args[0]);
      console.error(`This permanently deletes "${user.username}" and all of their notes, folders, tags, images and agents.`);
      const typed = (await ask(`Type the username (${user.username}) to confirm: `, false)).trim().toLowerCase();
      if (typed !== user.username) throw new UsageError('The username did not match. Nothing was deleted.');
      store.identity.deleteUser(user.username);
      console.log(`Deleted user "${user.username}".`);
      return;
    }
    case 'agent add': {
      need(2, 'agent add <username> <agent-name>');
      const r = store.identity.addAgent(args[0], args[1]);
      const url = `https://${config.host}/mcp`;
      console.log(`Created agent "${r.name}" for user "${r.username}".`);
      console.log('');
      console.log(`Token (shown only once; store it like a password):`);
      console.log(`  ${r.token}`);
      console.log('');
      console.log(`Notes this agent creates land in ${r.username}'s Inbox, marked "by ${r.name}".`);
      console.log('');
      console.log(clientInstructions(url, r.token));
      return;
    }
    case 'agent list': {
      if (args.length > 1) throw new UsageError('Usage: notes agent list [<username>]');
      const agents = store.identity.listAgents(args[0]);
      if (agents.length === 0) return void console.log('No agents.');
      table([
        ['AGENT', 'OWNER', 'CREATED', 'LAST USED', 'NOTES', 'STATUS'],
        ...agents.map((a) => [a.name, a.owner, date(a.createdAt), date(a.lastUsed), String(a.notesCreated), a.revoked ? 'revoked' : 'active']),
      ]);
      return;
    }
    case 'agent revoke': {
      need(2, 'agent revoke <username> <agent-name>');
      store.identity.revokeAgent(args[0], args[1]);
      console.log(`Revoked agent "${args[1]}" of "${normalizeUsername(args[0])}". Its token stops working now; its notes stay.`);
      return;
    }
    case 'data copy': {
      need(1, 'data copy <dir>');
      const r = await store.copy.dataCopy(args[0]);
      console.log(`Wrote ${r.db} and ${r.images} image file(s) under ${args[0]}.`);
      console.log('This is a one-off copy. Move it off the server, for example with "docker compose cp", then delete it here.');
      return;
    }
    default:
      throw new UsageError(area ? `Unknown command "${[area, cmd].filter(Boolean).join(' ')}".\n\n${USAGE}` : USAGE);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  const db = openDatabase(config.dbPath);
  try {
    migrate(db, config.dataDir, undefined, (m) => console.error(m));
    const store = new Store(db, { dataDir: config.dataDir, userQuotaBytes: config.userQuotaBytes, agentRatePerHour: config.agentRatePerHour });
    await run(argv, config, store);
    return 0;
  } catch (e) {
    if (e instanceof UsageError || e instanceof AppError || e instanceof MigrationError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  } finally {
    db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`notes: ${(e as Error).message}`);
    process.exit(1);
  },
);
