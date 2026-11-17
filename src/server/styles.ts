// Text styles (STYLES-SPEC): each user's named bundles of the eight text settings. A style is a
// stamp: applying it sets marks on text, which keeps no record of it, so nothing here touches notes.
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { stmt, type DB } from './db.js';
import { AppError, badRequest, notFound } from './errors.js';
import { isFontId } from '../shared/fonts.js';
import { HIGHLIGHT_COLORS, TEXT_COLORS, isFontSize, nameKey, nameProblem } from '../shared/schema.js';

export const STYLES_MAX = 50;
export const STYLE_NAME_MAX = 50;

export interface Style {
  id: string;
  name: string;
  font: string | null;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textColor: string | null;
  highlight: string | null;
}
export type StyleInput = Omit<Style, 'id'>;

const FIELDS = ['name', 'font', 'size', 'bold', 'italic', 'underline', 'strike', 'textColor', 'highlight'] as const;

/** The same names: trimmed, then lower-cased with JavaScript's toLowerCase() (as folders do). */
export const styleNameKey = nameKey;

/**
 * Check a create/replace body: exactly the name and the eight settings, each valid. The 400's message
 * names the field (never its value). Uses the note schema's own constants and the catalogue check.
 */
export function parseStyleInput(raw: unknown): StyleInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badRequest('The request must be a style object.', 'invalid_style');
  const b = raw as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!(FIELDS as readonly string[]).includes(k)) throw badRequest(`Unknown field "${k}".`, 'invalid_style');
  for (const k of FIELDS) if (!Object.hasOwn(b, k)) throw badRequest(`The field "${k}" is required.`, 'invalid_style');
  const bad = (field: string, what: string) => badRequest(`The field "${field}" ${what}`, 'invalid_style');

  if (typeof b.name !== 'string') throw bad('name', 'must be text.');
  const name = b.name.trim();
  const problem = nameProblem(name, STYLE_NAME_MAX, { c1: true });
  if (problem === 'empty') throw badRequest('Give the style a name.', 'invalid_name');
  if (problem === 'long') throw badRequest(`A style name can be at most ${STYLE_NAME_MAX} characters.`, 'invalid_name');
  if (problem === 'control') throw badRequest('The style name contains characters that are not allowed.', 'invalid_name');
  if (b.font !== null && !isFontId(b.font)) throw bad('font', 'must be null or a font from the catalogue.');
  if (!isFontSize(b.size)) throw bad('size', 'must be a whole number from 8 to 96.');
  for (const k of ['bold', 'italic', 'underline', 'strike'] as const) if (typeof b[k] !== 'boolean') throw bad(k, 'must be true or false.');
  if (b.textColor !== null && !(typeof b.textColor === 'string' && (TEXT_COLORS as readonly string[]).includes(b.textColor))) throw bad('textColor', 'must be null or a text colour name.');
  if (b.highlight !== null && !(typeof b.highlight === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(b.highlight))) throw bad('highlight', 'must be null or a highlight name.');
  return {
    name,
    font: b.font as string | null,
    size: b.size as number,
    bold: b.bold as boolean,
    italic: b.italic as boolean,
    underline: b.underline as boolean,
    strike: b.strike as boolean,
    textColor: b.textColor as string | null,
    highlight: b.highlight as string | null,
  };
}

const nameTaken = () => new AppError(409, 'name_taken', 'You already have a style with that name.');
const stylesFull = () => new AppError(409, 'styles_full', `You can keep at most ${STYLES_MAX} styles. Delete one to add another.`);

interface Row {
  id: string;
  name: string;
  font: string | null;
  size: number;
  bold: number;
  italic: number;
  underline: number;
  strike: number;
  text_color: string | null;
  highlight: string | null;
}
const toStyle = (r: Row): Style => ({
  id: r.id,
  name: r.name,
  font: r.font,
  size: r.size,
  bold: r.bold === 1,
  italic: r.italic === 1,
  underline: r.underline === 1,
  strike: r.strike === 1,
  textColor: r.text_color,
  highlight: r.highlight,
});
const COLS = 'id, name, font, size, bold, italic, underline, strike, text_color, highlight';
/** A style as `toStyle` gives it (same keys, same order), from the values just written. */
const asStyle = (id: string, s: StyleInput): Style => ({ id, name: s.name, font: s.font, size: s.size, bold: s.bold, italic: s.italic, underline: s.underline, strike: s.strike, textColor: s.textColor, highlight: s.highlight });

/** A unique-index violation: another request created the name between our check and our write. */
function isUniqueViolation(e: unknown) {
  return (e as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class StyleStore {
  constructor(
    private db: DB,
    private now: () => number,
  ) {}

  list(userId: string): Style[] {
    return (stmt(this.db, `SELECT ${COLS} FROM styles WHERE user_id = ? ORDER BY name_key, id`).all(userId) as Row[]).map(toStyle);
  }

  get(userId: string, id: string): Style | null {
    const r = stmt(this.db, `SELECT ${COLS} FROM styles WHERE user_id = ? AND id = ?`).get(userId, id) as Row | undefined;
    return r ? toStyle(r) : null;
  }

  /** The name check, the count check and the write in one BEGIN IMMEDIATE transaction. */
  create(userId: string, s: StyleInput): Style {
    const id = crypto.randomUUID();
    try {
      this.db
        .transaction(() => {
          if ((stmt(this.db, 'SELECT count(*) AS n FROM styles WHERE user_id = ?').get(userId) as { n: number }).n >= STYLES_MAX) throw stylesFull();
          if (stmt(this.db, 'SELECT 1 FROM styles WHERE user_id = ? AND name_key = ?').get(userId, styleNameKey(s.name))) throw nameTaken();
          const now = this.now();
          stmt(this.db, 'INSERT INTO styles (id, user_id, name, name_key, font, size, bold, italic, underline, strike, text_color, highlight, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, userId, s.name, styleNameKey(s.name), s.font, s.size, +s.bold, +s.italic, +s.underline, +s.strike, s.textColor, s.highlight, now, now);
        })
        .immediate();
    } catch (e) {
      if (isUniqueViolation(e)) throw nameTaken();
      throw e;
    }
    return asStyle(id, s); // what was written, without reading it back
  }

  /** Replace a style's name and settings; 404 for an id that is not this user's. Last save wins. */
  replace(userId: string, id: string, s: StyleInput): Style {
    try {
      this.db
        .transaction(() => {
          if (!this.get(userId, id)) throw notFound('No such style.');
          if (stmt(this.db, 'SELECT 1 FROM styles WHERE user_id = ? AND name_key = ? AND id != ?').get(userId, styleNameKey(s.name), id)) throw nameTaken();
          stmt(this.db, 'UPDATE styles SET name = ?, name_key = ?, font = ?, size = ?, bold = ?, italic = ?, underline = ?, strike = ?, text_color = ?, highlight = ?, updated_at = ? WHERE user_id = ? AND id = ?')
            .run(s.name, styleNameKey(s.name), s.font, s.size, +s.bold, +s.italic, +s.underline, +s.strike, s.textColor, s.highlight, this.now(), userId, id);
        })
        .immediate();
    } catch (e) {
      if (isUniqueViolation(e)) throw nameTaken();
      throw e;
    }
    return asStyle(id, s);
  }

  /** Delete the user's style with that id; an unknown or another user's id deletes nothing. */
  delete(userId: string, id: string): void {
    stmt(this.db, 'DELETE FROM styles WHERE user_id = ? AND id = ?').run(userId, id);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function registerStyleRoutes(api: FastifyInstance, styles: StyleStore) {
  api.get('/styles', async (req) => styles.list(req.user!.id));

  api.post('/styles', async (req, reply) => reply.status(201).send(styles.create(req.user!.id, parseStyleInput(req.body))));

  api.put('/styles/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const input = parseStyleInput(req.body);
    if (!UUID_RE.test(id)) throw notFound('No such style.');
    return styles.replace(req.user!.id, id, input);
  });

  api.delete('/styles/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    if (UUID_RE.test(id)) styles.delete(req.user!.id, id);
    return { ok: true };
  });
}
