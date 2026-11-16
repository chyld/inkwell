// Sign-out removes every font face and rule the app registered (runtime.ts and the modules built on it
// register here). Kept apart from runtime.ts so that the sign-in screen and the note list, which load no
// fonts, do not load the font catalogue just to clear nothing.
const clearers = new Set<() => void>();

export function onFontsCleared(f: () => void) {
  clearers.add(f);
  return () => clearers.delete(f);
}

/** Sign-out: every registered face (previews included) and every rule is removed. */
export function clearAllFonts() {
  for (const f of [...clearers]) f();
}
