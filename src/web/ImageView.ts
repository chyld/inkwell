// The editor's image node view: a selected image shows an outline and four corner handles. Dragging a handle
// (mouse, touch or pen) resizes it, keeping its ratio, between 40 px and the text column's width; releasing
// commits the size as one undo step, Escape cancels. The bottom-right handle is focusable (Tab from the
// selected image) and is a slider: arrows 10 px, Shift+arrows 1 px, Page Up/Down 50 px, Home/End the limits,
// R or a double-click on a handle returns to the image's own size. The size is stored as the node's width and
// height and rendered as the img element's width and height attributes, never as an inline style.
import { Extension, type NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import type { Editor } from '@tiptap/core';
import { SafeImage } from '../shared/schema';
import { CORNERS, IMAGE_MIN_WIDTH, dragSize, keySize, sizeText, type Corner, type Size } from './imageResize';

const VALIDATOR_MAX = 100000;
export const RESIZE_HELP = 'Drag to resize. Arrow keys: 10 px, Shift+arrows: 1 px, Page Up/Down: 50 px, Home/End: smallest/largest, R or double-click: original size, Escape: back to the note.';

interface Drag {
  pointerId: number;
  handle: HTMLElement;
  corner: Corner;
  x: number;
  y: number;
  width: number;
  ratio: number;
  maxWidth: number;
  size: Size | null;
}

export class ImageView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: PMNode;
  private handles: HTMLElement[] = [];
  private slider: HTMLElement | null = null;
  private readout: HTMLElement | null = null;
  private drag: Drag | null = null;

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private editor: Editor,
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'image-view';
    this.img = document.createElement('img');
    this.dom.appendChild(this.img);
    this.render(node);
  }

  /** The img element's attributes from the node: src, alt, title, and the stored size as width/height attributes. */
  private render(node: PMNode, size: Size | null = null) {
    const a = node.attrs;
    const set = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? this.img.removeAttribute(k) : this.img.setAttribute(k, String(v)));
    if (this.img.getAttribute('src') !== a.src) set('src', a.src);
    set('alt', a.alt);
    set('title', a.title);
    set('width', size ? size.width : a.width);
    set('height', size ? size.height : a.height);
  }

  /** The size shown now, the ratio (from the image itself when loaded) and the widest it may be (its column). */
  private measure(): { shown: Size; ratio: number; maxWidth: number } {
    const r = this.img.getBoundingClientRect();
    const shown = { width: Math.round(r.width), height: Math.round(r.height) };
    const { naturalWidth: nw, naturalHeight: nh } = this.img;
    const a = this.node.attrs;
    const ratio = nw > 0 && nh > 0 ? nh / nw : a.width > 0 && a.height > 0 ? a.height / a.width : shown.width > 0 && shown.height > 0 ? shown.height / shown.width : 1;
    const parent = this.dom.parentElement;
    let maxWidth = VALIDATOR_MAX;
    if (parent) {
      const cs = getComputedStyle(parent);
      const inner = parent.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (inner > 0) maxWidth = Math.min(VALIDATOR_MAX, Math.floor(inner));
    }
    return { shown, ratio, maxWidth };
  }

  private editable() {
    return this.editor.isEditable;
  }

  // ---- selection: outline and handles ----
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
    if (this.editable()) this.addHandles();
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
    this.endDrag(false);
    this.removeHandles();
  }

  private addHandles() {
    if (this.handles.length) return;
    for (const corner of CORNERS) {
      const h = document.createElement('span');
      h.className = 'image-handle';
      h.dataset.corner = corner;
      h.contentEditable = 'false';
      if (corner === 'bottom-right') {
        h.tabIndex = 0;
        h.setAttribute('role', 'slider');
        h.setAttribute('aria-label', 'Image size');
        h.setAttribute('aria-orientation', 'horizontal');
        h.setAttribute('aria-valuemin', String(IMAGE_MIN_WIDTH));
        h.title = RESIZE_HELP;
        h.addEventListener('keydown', this.onKey);
        h.addEventListener('focus', this.onFocus);
        h.addEventListener('blur', this.onBlur);
        this.slider = h;
      } else h.setAttribute('aria-hidden', 'true');
      h.addEventListener('pointerdown', (e) => this.onDown(e, h, corner));
      h.addEventListener('pointermove', this.onMove);
      h.addEventListener('pointerup', this.onUp);
      h.addEventListener('pointercancel', this.onCancel);
      h.addEventListener('dblclick', this.onDouble);
      this.handles.push(h);
      this.dom.appendChild(h);
    }
    this.readout = document.createElement('span');
    this.readout.className = 'image-size';
    this.readout.setAttribute('aria-hidden', 'true');
    this.dom.appendChild(this.readout);
    this.updateSlider();
  }

  private removeHandles() {
    for (const h of this.handles) h.remove();
    this.handles = [];
    this.slider = null;
    this.readout?.remove();
    this.readout = null;
  }

  /** The slider's current value, spoken as "320 × 180 pixels". */
  private updateSlider(size?: Size) {
    if (!this.slider) return;
    const m = this.measure();
    const s = size ?? m.shown;
    this.slider.setAttribute('aria-valuemax', String(Math.max(IMAGE_MIN_WIDTH, m.maxWidth)));
    this.slider.setAttribute('aria-valuenow', String(s.width));
    this.slider.setAttribute('aria-valuetext', `${sizeText(s)} pixels`);
    if (this.readout) this.readout.textContent = sizeText(s);
  }

  private showReadout(on: boolean) {
    this.dom.classList.toggle('show-size', on);
  }

  // ---- pointer ----
  private onDown(e: PointerEvent, handle: HTMLElement, corner: Corner) {
    if (!this.editable() || e.button > 0 || this.drag) return;
    e.preventDefault();
    e.stopPropagation();
    const m = this.measure();
    if (m.shown.width <= 0) return;
    this.drag = { pointerId: e.pointerId, handle, corner, x: e.clientX, y: e.clientY, width: m.shown.width, ratio: m.ratio, maxWidth: m.maxWidth, size: null };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* not every environment has pointer capture */
    }
    this.dom.classList.add('resizing');
    this.updateSlider(m.shown);
    this.showReadout(true);
    document.addEventListener('keydown', this.onDragKey, true);
  }

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    d.size = dragSize({ width: d.width, ratio: d.ratio, corner: d.corner, maxWidth: d.maxWidth }, e.clientX - d.x, e.clientY - d.y);
    this.render(this.node, d.size); // live, as attributes; nothing is stored until release
    this.updateSlider(d.size);
  };

  private onUp = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(true);
  };

  private onCancel = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(false);
  };

  private onDragKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.endDrag(false);
  };

  private endDrag(commit: boolean) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    document.removeEventListener('keydown', this.onDragKey, true);
    try {
      if (d.handle.hasPointerCapture?.(d.pointerId)) d.handle.releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    this.dom.classList.remove('resizing');
    this.showReadout(document.activeElement === this.slider);
    if (commit && d.size) this.commit(d.size);
    else this.render(this.node); // cancelled: back to the stored size, no transaction
    this.updateSlider();
  }

  private onDouble = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.editable()) this.commit(null);
  };

  // ---- keyboard ----
  private onFocus = () => {
    this.updateSlider();
    this.showReadout(true);
  };

  private onBlur = () => {
    if (!this.drag) this.showReadout(false);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      this.view.focus(); // back to the note, with the image still selected
      return;
    }
    if (!this.editable() || e.altKey || e.ctrlKey || e.metaKey) return;
    const m = this.measure();
    const r = keySize(e.key, e.shiftKey, m.shown.width, m.ratio, m.maxWidth);
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    // Each press is its own undo step (a size change has no positions, so the history never merges them).
    this.commit(r.kind === 'reset' ? null : r.size);
    this.updateSlider();
  };

  /** Store a size (null: the image's own size) in one transaction (one undo step), keeping the image selected. */
  private commit(size: Size | null) {
    const pos = this.getPos();
    const a = this.node.attrs;
    if (typeof pos !== 'number' || ((a.width ?? null) === (size?.width ?? null) && (a.height ?? null) === (size?.height ?? null))) {
      this.render(this.node);
      return;
    }
    const tr = this.view.state.tr;
    closeHistory(tr);
    tr.setNodeAttribute(pos, 'width', size?.width ?? null).setNodeAttribute(pos, 'height', size?.height ?? null);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.view.dispatch(tr);
  }

  // ---- ProseMirror ----
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.drag) this.render(node);
    if (!this.editable()) this.removeHandles();
    this.updateSlider();
    return true;
  }

  /** Events on the handles are ours; everything else (selecting, dragging the image to move it) is the editor's. */
  stopEvent(e: Event) {
    const t = e.target as Element | null;
    return !!t && typeof t.closest === 'function' && !!t.closest('.image-handle');
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.endDrag(false);
    this.removeHandles();
  }
}

/** The image node with the resize view (web only), and Tab from a selected image to its resize handle. */
export const ResizableImage = SafeImage.extend({
  addNodeView() {
    return ({ node, view, getPos, editor }: NodeViewRendererProps) => new ImageView(node, view, getPos as () => number | undefined, editor);
  },
});

export const ImageResizeKeys = Extension.create({
  name: 'imageResizeKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const sel = editor.state.selection;
        if (!editor.isEditable || !(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false;
        const handle = (editor.view.nodeDOM(sel.from) as HTMLElement | null)?.querySelector<HTMLElement>('.image-handle[role="slider"]');
        if (!handle) return false;
        handle.focus();
        return true;
      },
    };
  },
});
