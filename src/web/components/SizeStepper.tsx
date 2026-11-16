// The − / size / + stepper, in the toolbar and in the style form: the markup and the check of a typed size. Each
// caller decides when a size takes effect (the toolbar on Enter, the form as it is typed) and what the steps do.
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../shared/noteRules';

/** A typed size: one or two digits, from FONT_SIZE_MIN to FONT_SIZE_MAX; otherwise null. */
export function parseSize(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9]{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX ? n : null;
}

interface Props {
  text: string;
  onText: (text: string) => void;
  canDecrease: boolean;
  canIncrease: boolean;
  onStep: (delta: -1 | 1) => void;
  disabled?: boolean;
  /** In the toolbar, pressing − or + leaves the focus in the note. */
  keepEditorFocus?: boolean;
  /** The caller's own handling of the box (focus, keys, leaving it). */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

export function SizeStepper({ text, onText, canDecrease, canIncrease, onStep, disabled = false, keepEditorFocus = false, inputProps }: Props) {
  const button = (label: string, icon: ReactNode, enabled: boolean, step: -1 | 1) => (
    <button
      type="button"
      className="tb"
      aria-label={label}
      title={label}
      disabled={disabled || !enabled}
      onMouseDown={keepEditorFocus ? (e) => e.preventDefault() : undefined}
      onClick={() => onStep(step)}
    >
      {icon}
    </button>
  );
  return (
    <div className="tb-group size-group" role="group" aria-label="Font size">
      {button('Decrease font size', <Minus />, canDecrease, -1)}
      <input
        className="size-input"
        type="text"
        inputMode="numeric"
        aria-label="Font size"
        title="Font size"
        maxLength={2}
        disabled={disabled}
        value={text}
        onChange={(e) => onText(e.target.value)}
        {...inputProps}
      />
      {button('Increase font size', <Plus />, canIncrease, 1)}
    </div>
  );
}
