// Drawing text in a style outside the editor (STYLES-SPEC 10): the same elements the editor produces,
// nested, in a container that gives them the rules they have in a note. Nothing uses an inline style.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { SampleFontSession } from '../fonts/runtime';

import type { StyleSettings } from '../api';
export type { StyleSettings };

const SampleFonts = createContext<SampleFontSession | null>(null);

/** One opening of a card page, a menu or the form: its samples' fonts are asked for once. */
export function SampleFontsProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new SampleFontSession());
  useEffect(() => () => session.close(), [session]);
  return <SampleFonts.Provider value={session}>{children}</SampleFonts.Provider>;
}

export function useSampleFonts(): SampleFontSession | null {
  return useContext(SampleFonts);
}

/** `text` drawn with a style's settings; where a cap applies, the size is the smaller of the two. */
export function StyleSample({ style, text, cap, className }: { style: StyleSettings; text: string; cap?: number; className?: string }) {
  const session = useSampleFonts();
  useEffect(() => {
    if (style.font) session?.want([style.font]);
  }, [session, style.font]);
  const size = cap ? Math.min(style.size, cap) : style.size;
  let el: ReactNode = text;
  if (style.strike) el = <s>{el}</s>;
  if (style.underline) el = <u>{el}</u>;
  if (style.italic) el = <em>{el}</em>;
  if (style.bold) el = <strong>{el}</strong>;
  if (style.highlight) el = <mark data-highlight={style.highlight}>{el}</mark>;
  if (style.textColor) el = <span data-text-color={style.textColor}>{el}</span>;
  el = <span data-font-size={size}>{el}</span>;
  if (style.font) el = <span data-font={style.font}>{el}</span>;
  return <span className={'style-sample' + (className ? ` ${className}` : '')}>{el}</span>;
}
