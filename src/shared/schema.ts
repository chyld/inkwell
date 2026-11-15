// The one note-schema module (SPEC 6.2). Used by the editor, by server-side
// validation of every save, and by the agent Markdown converter.
import { getSchema, type AnyExtension, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';

export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
export const MAX_TITLE_CHARS = 200;

const IMAGE_SRC_RE = /^\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

/** Image id from an allowed `src`, or null. */
export function imageIdFromSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const m = IMAGE_SRC_RE.exec(src);
  return m ? m[1] : null;
}

export function imageSrc(id: string): string {
  return `/api/images/${id}`;
}

/** True for absolute http, https and mailto URLs only. */
export function isAllowedHref(href: unknown): boolean {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) return false;
  // Reject control characters and whitespace that browsers strip before parsing a scheme.
  if (/[\u0000- \u007f]/.test(href)) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol)) return false;
  // The scheme must be written literally at the start (no tricks like "java\tscript:").
  return href.toLowerCase().startsWith(url.protocol);
}

/** No merged cells and no stored column widths, even in pasted HTML (SPEC 6.2). */
function noMergeCell<T extends typeof TableCell | typeof TableHeader>(cell: T): T {
  return cell.extend({
    addAttributes() {
      const parent = this.parent?.() ?? {};
      return {
        ...parent,
        colspan: { default: 1, parseHTML: () => 1 },
        rowspan: { default: 1, parseHTML: () => 1 },
        colwidth: { default: null, parseHTML: () => null },
      };
    },
  }) as T;
}

const SafeImage = Image.extend({
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => (imageIdFromSrc((el as { getAttribute(n: string): string | null }).getAttribute('src')) ? null : false),
      },
    ];
  },
}).configure({ inline: false, allowBase64: false });

/** The extensions that define the note schema. The editor adds only behaviour, never node or mark types. */
export const noteExtensions: AnyExtension[] = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    underline: false,
    link: {
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      protocols: [],
      isAllowedUri: (url: string) => isAllowedHref(url),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    },
  }),
  Table.configure({ resizable: false }),
  TableRow,
  noMergeCell(TableCell),
  noMergeCell(TableHeader),
  SafeImage,
  TaskList,
  TaskItem.configure({ nested: true }),
];

let cachedSchema: Schema | null = null;
export function noteSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(noteExtensions);
  return cachedSchema;
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

// ---- strict validation -------------------------------------------------

type AttrCheck = (v: unknown) => boolean;
const isNull = (v: unknown) => v === null || v === undefined;
const optString = (max: number): AttrCheck => (v) => isNull(v) || (typeof v === 'string' && v.length <= max);
const cellSpan: AttrCheck = (v) => isNull(v) || v === 1;
const colwidth: AttrCheck = (v) =>
  isNull(v) || (Array.isArray(v) && v.length === 1 && (v[0] === null || (Number.isInteger(v[0]) && v[0] > 0 && v[0] < 10000)));
const align: AttrCheck = (v) => isNull(v) || v === 'left' || v === 'center' || v === 'right';
const dimension: AttrCheck = (v) => isNull(v) || (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100000);

const NODE_ATTRS: Record<string, Record<string, AttrCheck>> = {
  doc: {},
  paragraph: {},
  text: {},
  heading: { level: (v) => v === 1 || v === 2 || v === 3 },
  blockquote: {},
  bulletList: {},
  orderedList: {
    start: (v) => isNull(v) || (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e9),
    type: (v) => isNull(v) || v === '1' || v === 'a' || v === 'A' || v === 'i' || v === 'I',
  },
  listItem: {},
  taskList: {},
  taskItem: { checked: (v) => isNull(v) || typeof v === 'boolean' },
  codeBlock: { language: (v) => isNull(v) || (typeof v === 'string' && /^[\w+#.-]{0,40}$/.test(v)) },
  horizontalRule: {},
  hardBreak: {},
  table: {},
  tableRow: {},
  tableCell: { colspan: cellSpan, rowspan: cellSpan, colwidth, align },
  tableHeader: { colspan: cellSpan, rowspan: cellSpan, colwidth, align },
  image: {
    src: (v) => imageIdFromSrc(v) !== null,
    alt: optString(1000),
    title: optString(1000),
    width: dimension,
    height: dimension,
  },
};

const MARK_ATTRS: Record<string, Record<string, AttrCheck>> = {
  bold: {},
  italic: {},
  strike: {},
  code: {},
  link: {
    href: (v) => isAllowedHref(v),
    target: (v) => isNull(v) || v === '_blank',
    rel: optString(100),
    class: (v) => isNull(v),
    title: optString(1000),
  },
};

export class NoteValidationError extends Error {}

function fail(msg: string): never {
  throw new NoteValidationError(msg);
}

function checkAttrs(where: string, attrs: unknown, allowed: Record<string, AttrCheck>) {
  if (attrs === undefined || attrs === null) return;
  if (typeof attrs !== 'object' || Array.isArray(attrs)) fail(`${where}: attrs must be an object`);
  for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
    const check = allowed[k];
    if (!check) fail(`${where}: attribute "${k}" is not allowed`);
    if (!check(v)) fail(`${where}: attribute "${k}" has a value that is not allowed`);
  }
  if (where === 'image' && imageIdFromSrc((attrs as Record<string, unknown>).src) === null) fail('image: src is required');
  if (where === 'link' && !isAllowedHref((attrs as Record<string, unknown>).href)) fail('link: href is required');
}

function walk(node: unknown, depth: number, imageIds: Set<string>) {
  if (depth > 100) fail('document is nested too deeply');
  if (typeof node !== 'object' || node === null || Array.isArray(node)) fail('node must be an object');
  const n = node as Record<string, unknown>;
  for (const k of Object.keys(n)) {
    if (!['type', 'attrs', 'content', 'marks', 'text'].includes(k)) fail(`unexpected key "${k}"`);
  }
  if (typeof n.type !== 'string' || !(n.type in NODE_ATTRS)) fail(`node type "${String(n.type)}" is not allowed`);
  const type = n.type;
  checkAttrs(type, n.attrs, NODE_ATTRS[type]);
  if (type === 'image') imageIds.add(imageIdFromSrc((n.attrs as Record<string, unknown>).src)!);
  if (type === 'image' && n.attrs === undefined) fail('image: src is required');
  if (type === 'text') {
    if (typeof n.text !== 'string' || n.text.length === 0) fail('text node needs non-empty text');
  } else if (n.text !== undefined) fail(`${type}: unexpected text`);
  if (n.marks !== undefined) {
    if (!Array.isArray(n.marks)) fail('marks must be an array');
    for (const m of n.marks) {
      if (typeof m !== 'object' || m === null) fail('mark must be an object');
      const mm = m as Record<string, unknown>;
      for (const k of Object.keys(mm)) if (k !== 'type' && k !== 'attrs') fail(`unexpected mark key "${k}"`);
      if (typeof mm.type !== 'string' || !(mm.type in MARK_ATTRS)) fail(`mark type "${String(mm.type)}" is not allowed`);
      checkAttrs(mm.type, mm.attrs, MARK_ATTRS[mm.type]);
      if (mm.type === 'link' && mm.attrs === undefined) fail('link: href is required');
    }
  }
  if (n.content !== undefined) {
    if (!Array.isArray(n.content)) fail('content must be an array');
    for (const c of n.content) walk(c, depth + 1, imageIds);
  }
}

function checkTables(doc: PMNode) {
  doc.descendants((node) => {
    if (node.type.name !== 'table') return true;
    let width = -1;
    node.forEach((row, _o, rowIndex) => {
      let w = 0;
      row.forEach((cell) => {
        if (cell.type.name === 'tableHeader' && rowIndex !== 0) fail('table: header cells are allowed only in the first row');
        w += 1;
      });
      if (width === -1) width = w;
      else if (w !== width) fail('table: all rows must have the same number of cells');
    });
    return true;
  });
}

export interface ValidatedBody {
  doc: PMNode;
  json: JSONContent;
  /** Serialised JSON exactly as stored. */
  serialized: string;
  bytes: number;
  text: string;
  imageIds: string[];
}

/** Validate a note body. Throws NoteValidationError. Does not check image ownership. */
export function validateBody(input: unknown): ValidatedBody {
  const imageIds = new Set<string>();
  walk(input, 0, imageIds);
  if ((input as { type: string }).type !== 'doc') fail('top-level node must be "doc"');
  let doc: PMNode;
  try {
    doc = noteSchema().nodeFromJSON(input);
    doc.check();
  } catch (e) {
    fail(`document structure is not valid: ${(e as Error).message}`);
  }
  checkTables(doc);
  const json = doc.toJSON() as JSONContent;
  const serialized = JSON.stringify(json);
  const bytes = utf8Length(serialized);
  if (bytes > MAX_BODY_BYTES) fail('note body is larger than 1 MB');
  return { doc, json, serialized, bytes, text: plainText(doc), imageIds: [...imageIds] };
}

/** Plain text of a document, used only for search. */
export function plainText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n', (leaf) => {
    if (leaf.type.name === 'hardBreak') return '\n';
    if (leaf.type.name === 'image') return leaf.attrs.alt ? ` ${leaf.attrs.alt} ` : ' ';
    return '';
  });
}

const encoder = new TextEncoder();
export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** Character count in Unicode code points. */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export const TAG_MAX_CHARS = 50;
export const TAGS_PER_NOTE = 20;

/** Normalise a tag (SPEC 7.2). Returns null if it breaks a rule. */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t.length === 0 || charLength(t) > TAG_MAX_CHARS || t.includes(',')) return null;
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}
