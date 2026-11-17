// The Inkwell mark: a squat ink bottle in coral, a slate neck, and a drop of ink on the bottle. Flat, three
// shapes, drawn on a 32-unit grid so it stays readable at 16px. public/favicon.svg uses the same paths
// (test/web/inkwell-mark.test.tsx keeps them equal). Inline, the neck takes the text colour around it
// (currentColor) and the bottle and drop use the coral fill and its ink (--accent, --accent-text), so it
// reads on paper, on the slate rail, and in dark mode.
export const MARK_NECK = 'M11.5 4h9A1.5 1.5 0 0 1 22 5.5v2A1.5 1.5 0 0 1 20.5 9H20v3h-8V9h-.5A1.5 1.5 0 0 1 10 7.5v-2A1.5 1.5 0 0 1 11.5 4z';
export const MARK_BOTTLE = { x: 4, y: 11, width: 24, height: 18, rx: 6 };
export const MARK_DROP = 'M16 14.5c-2.7 3.5-4.2 5.8-4.2 7.6a4.2 4.2 0 0 0 8.4 0c0-1.8-1.5-4.1-4.2-7.6z';

export function InkwellMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={'inkwell-mark' + (className ? ' ' + className : '')} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path className="inkwell-neck" d={MARK_NECK} />
      <rect className="inkwell-bottle" {...MARK_BOTTLE} />
      <path className="inkwell-drop" d={MARK_DROP} />
    </svg>
  );
}
