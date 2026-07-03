/**
 * Competitions available on the free plan. Server-side source of truth for
 * gating — the client has its own copy for display, but access is enforced
 * here so a free user can't unlock the full library from devtools.
 */
export const FEATURED_COMP_IDS = new Set<string>([
  "CubingUSANationals2023",
  "WC2019",
  "WC2015",
]);
