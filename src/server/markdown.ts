// Agent Markdown → note document (SPEC 8.3). CommonMark plus GFM tables, task
// lists and strikethrough, converted on the server into the schema of 6.2.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent, PhrasingContent, Definition, ListItem, Table } from 'mdast';
import { Fragment, type Mark, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { isAllowedHref, MAX_BODY_BYTES, NoteValidationError, noteSchema } from '../shared/schema.js';

const parser = unified().use(remarkParse).use(remarkGfm);

type Ctx = { schema: Schema; defs: Map<string, Definition>; cells: number };

/**
 * Every table cell, even an empty one, takes well over 100 bytes of stored JSON,
 * so a document with more cells than this cannot fit in a 1 MB body. Checked
 * before cells are built: GFM pads short rows, so a few bytes of Markdown could
 * otherwise ask for millions of cells.
 */
export const MAX_TABLE_CELLS = Math.floor(MAX_BODY_BYTES / 100);

/** Table cells built so far (a test seam: shows the budget rejects before building). */
export const conversionStats = { cellsBuilt: 0 };

function addMark(marks: readonly Mark[], mark: Mark): readonly Mark[] {
  return mark.addToSet(marks);
}

function textNode(ctx: Ctx, text: string, marks: readonly Mark[]): PMNode[] {
  // Soft line breaks inside a paragraph become spaces; empty text is not allowed.
  const t = text.replace(/\r?\n/g, ' ');
  if (!t) return [];
  return [ctx.schema.text(t, marks)];
}

function plainOf(nodes: PhrasingContent[] | RootContent[]): string {
  let out = '';
  for (const n of nodes as any[]) {
    if (typeof n.value === 'string') out += n.value;
    else if (n.type === 'image' || n.type === 'imageReference') out += n.alt ?? '';
    else if (n.type === 'break') out += ' ';
    else if (Array.isArray(n.children)) out += plainOf(n.children);
  }
  return out;
}

function inline(ctx: Ctx, nodes: PhrasingContent[], marks: readonly Mark[]): PMNode[] {
  const s = ctx.schema;
  const out: PMNode[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out.push(...textNode(ctx, n.value, marks));
        break;
      case 'emphasis':
        out.push(...inline(ctx, n.children, addMark(marks, s.marks.italic.create())));
        break;
      case 'strong':
        out.push(...inline(ctx, n.children, addMark(marks, s.marks.bold.create())));
        break;
      case 'delete':
        out.push(...inline(ctx, n.children, addMark(marks, s.marks.strike.create())));
        break;
      case 'inlineCode': {
        // The code mark excludes other marks except a link; keep the link if there is one.
        const link = marks.find((m) => m.type.name === 'link');
        const codeMarks = link ? addMark([link], s.marks.code.create()) : [s.marks.code.create()];
        out.push(...textNode(ctx, n.value, codeMarks));
        break;
      }
      case 'break':
        out.push(s.nodes.hardBreak.create());
        break;
      case 'link':
        out.push(...linkTo(ctx, n.url, n.title ?? null, n.children, marks));
        break;
      case 'linkReference': {
        const def = ctx.defs.get(n.identifier.toLowerCase());
        if (def) out.push(...linkTo(ctx, def.url, def.title ?? null, n.children, marks));
        else out.push(...textNode(ctx, sourceOfReference(n), marks));
        break;
      }
      case 'image':
      case 'imageReference':
        // Images become their alt text.
        if (n.alt) out.push(...textNode(ctx, n.alt, marks));
        break;
      case 'html':
        // Raw HTML is kept as literal text.
        out.push(...textNode(ctx, n.value, marks));
        break;
      case 'footnoteReference':
        out.push(...textNode(ctx, `[^${n.label ?? n.identifier}]`, marks));
        break;
      default:
        out.push(...textNode(ctx, plainOf([n as PhrasingContent]), marks));
    }
  }
  return out;
}

function sourceOfReference(n: { children: PhrasingContent[]; label?: string | null; referenceType: string }): string {
  const text = plainOf(n.children);
  if (n.referenceType === 'full') return `[${text}][${n.label ?? ''}]`;
  if (n.referenceType === 'collapsed') return `[${text}][]`;
  return `[${text}]`;
}

function linkTo(ctx: Ctx, url: string, title: string | null, children: PhrasingContent[], marks: readonly Mark[]): PMNode[] {
  if (!isAllowedHref(url)) return inline(ctx, children, marks); // other schemes become plain text
  const link = ctx.schema.marks.link.create({ href: url, title: title || null, target: '_blank', rel: 'noopener noreferrer nofollow' });
  return inline(ctx, children, addMark(marks, link));
}

function paragraph(ctx: Ctx, children: PhrasingContent[]): PMNode {
  return ctx.schema.nodes.paragraph.create(null, inline(ctx, children, []));
}

function listItemContent(ctx: Ctx, item: ListItem): PMNode[] {
  const blocks = blocksOf(ctx, item.children);
  // A list item must start with a paragraph.
  if (blocks.length === 0 || blocks[0].type.name !== 'paragraph') blocks.unshift(ctx.schema.nodes.paragraph.create());
  return blocks;
}

function table(ctx: Ctx, t: Table): PMNode {
  const s = ctx.schema;
  let width = 1;
  for (const r of t.children) width = Math.max(width, r.children.length);
  ctx.cells += width * t.children.length;
  if (ctx.cells > MAX_TABLE_CELLS) throw new NoteValidationError('note body is larger than 1 MB (the tables have too many cells)');
  const rows = t.children.map((row, i) => {
    const cellType = i === 0 ? s.nodes.tableHeader : s.nodes.tableCell;
    const cells: PMNode[] = [];
    for (let c = 0; c < width; c++) {
      const cell = row.children[c];
      const align = t.align?.[c] ?? null;
      const para = s.nodes.paragraph.create(null, cell ? inline(ctx, cell.children, []) : []);
      cells.push(cellType.create({ align }, para));
      conversionStats.cellsBuilt++;
    }
    return s.nodes.tableRow.create(null, cells);
  });
  return s.nodes.table.create(null, rows);
}

function blocksOf(ctx: Ctx, nodes: RootContent[]): PMNode[] {
  const s = ctx.schema;
  const out: PMNode[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
        out.push(paragraph(ctx, n.children));
        break;
      case 'heading':
        out.push(s.nodes.heading.create({ level: Math.min(3, n.depth) }, inline(ctx, n.children, [])));
        break;
      case 'thematicBreak':
        out.push(s.nodes.horizontalRule.create());
        break;
      case 'blockquote': {
        const inner = blocksOf(ctx, n.children);
        out.push(s.nodes.blockquote.create(null, inner.length ? inner : [s.nodes.paragraph.create()]));
        break;
      }
      case 'code':
        out.push(s.nodes.codeBlock.create({ language: n.lang && /^[\w+#.-]{1,40}$/.test(n.lang) ? n.lang : null }, n.value ? s.text(n.value) : null));
        break;
      case 'html':
        // Raw HTML is kept as literal text.
        out.push(s.nodes.paragraph.create(null, n.value ? s.text(n.value) : null));
        break;
      case 'list': {
        const isTask = n.children.some((i) => typeof i.checked === 'boolean');
        if (isTask) {
          out.push(s.nodes.taskList.create(null, n.children.map((i) => s.nodes.taskItem.create({ checked: i.checked === true }, listItemContent(ctx, i)))));
        } else if (n.ordered) {
          out.push(s.nodes.orderedList.create({ start: n.start ?? 1 }, n.children.map((i) => s.nodes.listItem.create(null, listItemContent(ctx, i)))));
        } else {
          out.push(s.nodes.bulletList.create(null, n.children.map((i) => s.nodes.listItem.create(null, listItemContent(ctx, i)))));
        }
        break;
      }
      case 'table':
        out.push(table(ctx, n));
        break;
      case 'definition':
        break; // used for references; not shown
      case 'footnoteDefinition': {
        const inner = blocksOf(ctx, n.children);
        const label = s.text(`[^${n.label ?? n.identifier}]: `);
        if (inner.length && inner[0].type.name === 'paragraph') {
          inner[0] = s.nodes.paragraph.create(null, Fragment.from(label).append(inner[0].content));
        } else inner.unshift(s.nodes.paragraph.create(null, label));
        out.push(...inner);
        break;
      }
      case 'yaml':
        out.push(s.nodes.paragraph.create(null, n.value ? s.text(n.value) : null));
        break;
      default: {
        const text = plainOf([n]);
        if (text) out.push(s.nodes.paragraph.create(null, s.text(text)));
      }
    }
  }
  return out;
}

function collectDefinitions(node: any, defs: Map<string, Definition>) {
  if (node.type === 'definition' && !defs.has(node.identifier.toLowerCase())) defs.set(node.identifier.toLowerCase(), node);
  if (Array.isArray(node.children)) for (const c of node.children) collectDefinitions(c, defs);
}

/** Convert Markdown to note-document JSON. The result still goes through validateBody. */
export function markdownToDoc(markdown: string): unknown {
  const schema = noteSchema();
  const tree = parser.parse(markdown) as Root;
  const defs = new Map<string, Definition>();
  collectDefinitions(tree, defs);
  const blocks = blocksOf({ schema, defs, cells: 0 }, tree.children);
  const doc = schema.nodes.doc.create(null, blocks.length ? blocks : [schema.nodes.paragraph.create()]);
  return doc.toJSON();
}
