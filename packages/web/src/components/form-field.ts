/**
 * One class string for a native `<input>` / `<select>` / `<textarea>` styled as a field.
 *
 * The cockpit's native controls are deliberately not Radix `Select`/`Input` — a roster's backend
 * picker is read as `HTMLSelectElement` by its tests and needs to stay a real `<select>` — but the
 * four copies of this class had already drifted (`disabled:opacity-50` was missing on the composer
 * pill's copy), which is the one-brake-three-places mistake `chipClass` was factored out to avoid.
 */
export const fieldClass =
  'block w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50'
