/**
 * The competitions available on the free plan. Curated, stable past comps —
 * all three verified to have first-round 3x3 scrambles on the WCA API.
 * Display data is inlined so the default picker view renders instantly and
 * deterministically. Gating is visual only in this version (no accounts).
 */
export type FeaturedComp = {
  id: string;
  name: string;
  city: string;
  start_date: string;
};

export const FEATURED_COMPS: FeaturedComp[] = [
  {
    id: "CubingUSANationals2023",
    name: "CubingUSA Nationals 2023",
    city: "Pittsburgh, Pennsylvania",
    start_date: "2023-07-27",
  },
  {
    id: "WC2019",
    name: "WCA World Championship 2019",
    city: "Melbourne, Victoria",
    start_date: "2019-07-11",
  },
  {
    id: "WC2015",
    name: "World Rubik's Cube Championship 2015",
    city: "São Paulo",
    start_date: "2015-07-17",
  },
];

export const FEATURED_COMP_IDS = new Set(FEATURED_COMPS.map((c) => c.id));
