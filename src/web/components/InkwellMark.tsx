// The Inkwell mark: a squat ink bottle in coral, a slate neck, and a drop of ink on the bottle. Flat, three
// shapes, drawn on a 32-unit grid so it stays readable at 16px. public/favicon.svg uses the same paths
// (test/web/inkwell-mark.test.tsx keeps them equal). Inline, the neck takes the text colour around it
// (currentColor) and the bottle and drop use the coral fill and its ink (--accent, --accent-text), so it
// reads on paper, on the slate rail, and in dark mode.
export const MARK_NECK = 'M11.5 4h9A1.5 1.5 0 0 1 22 5.5v1A1.5 1.5 0 0 1 20.5 8H20v4h-8V8h-.5A1.5 1.5 0 0 1 10 6.5v-1A1.5 1.5 0 0 1 11.5 4z';
export const MARK_BOTTLE = { x: 4, y: 12, width: 24, height: 16, rx: 6 };
export const MARK_DROP = 'M16 15c-2.7 3.4-4 5.6-4 7.5a4 4 0 0 0 8 0c0-1.9-1.3-4.1-4-7.5z';

export function InkwellMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={'inkwell-mark' + (className ? ' ' + className : '')} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path className="inkwell-neck" d={MARK_NECK} />
      <rect className="inkwell-bottle" {...MARK_BOTTLE} />
      <path className="inkwell-drop" d={MARK_DROP} />
    </svg>
  );
}
