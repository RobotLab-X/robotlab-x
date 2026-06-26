/**
 * Deterministic color per runtime id.
 *
 * The chip bar, header stripe, and any future per-runtime decoration
 * read from these helpers so the same runtime always looks the same
 * across the UI — and two different runtimes never accidentally land
 * on the same color in the same session.
 *
 * Algorithm: simple djb2-ish string hash → HSL with a fixed
 * saturation/lightness band that reads well on dark backgrounds.
 * Pure-function — no state, no global registry.
 */


/** A stable HSL hue (0-360) for ``id``. Same input → same output. */
function hashHue(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 360
}


/** Primary accent — used for the chip background + the header
 * stripe. Hue derived from id; saturation + lightness fixed for
 * legibility on slate-950. */
export function runtimePrimary(id: string): string {
  const h = hashHue(id)
  return `hsl(${h}, 65%, 55%)`
}


/** Muted background — same hue, lower saturation. For card surfaces
 * tinted to indicate "this is the X runtime's data". */
export function runtimeMuted(id: string): string {
  const h = hashHue(id)
  return `hsl(${h}, 35%, 28%)`
}


/** A very faint background — under-chip / hover halo. */
export function runtimeFaint(id: string): string {
  const h = hashHue(id)
  return `hsl(${h}, 30%, 20%)`
}
