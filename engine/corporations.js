// Acquire — tournament corps + colors, CLASSIC mechanics.
// Classic tiers: 2 cheap (200) / 3 mid (300) / 2 expensive (400).
//   Tower(200, yellow) | Sackson(200, red, replaces Luxor)
//   American(300, dark blue) | Worldwide(300, purple) | Festival(300, dark green)
//   Imperial(400, orange) | Continental(400, light blue)

export const CORPORATIONS = [
  { id: 0, name: "Tower", short: "T", color: "#eab308", textOn: "#1a1a1a", tier: "low", base: 200, oldName: "Tower" },
  { id: 1, name: "Sackson", short: "S", color: "#e5484d", textOn: "#ffffff", tier: "low", base: 200, oldName: "Luxor" },
  { id: 2, name: "American", short: "A", color: "#1e40af", textOn: "#ffffff", tier: "mid", base: 300, oldName: "American" },
  { id: 3, name: "Worldwide", short: "W", color: "#7c3aed", textOn: "#ffffff", tier: "mid", base: 300, oldName: "Worldwide" },
  { id: 4, name: "Festival", short: "F", color: "#166534", textOn: "#ffffff", tier: "mid", base: 300, oldName: "Festival" },
  { id: 5, name: "Imperial", short: "I", color: "#ea580c", textOn: "#ffffff", tier: "high", base: 400, oldName: "Imperial" },
  { id: 6, name: "Continental", short: "C", color: "#38bdf8", textOn: "#1a1a1a", tier: "high", base: 400, oldName: "Continental" },
];

export const CORP_BY_ID = Object.fromEntries(CORPORATIONS.map((c) => [c.id, c]));
export const CORP_BY_NAME = Object.fromEntries(CORPORATIONS.map((c) => [c.name.toLowerCase(), c]));
