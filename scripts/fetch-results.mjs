// Pulls World Cup data from football-data.org (free tier covers the World Cup)
// and writes results.json in the shape index.html reads:
//   { updatedAt, source, results, kickoffs, knockout }
// - results : group scores, worked out from team names (not the API's grouping)
// - kickoffs: kick-off time (UTC) per group fixture, shown in each viewer's local time
// - knockout: the live bracket — only filled once real knockout teams exist
//
// Needs a free token in env FOOTBALL_DATA_TOKEN.
//   FOOTBALL_DATA_TOKEN=xxxx node scripts/fetch-results.mjs   (Node 18+)

import { writeFileSync, readFileSync } from "node:fs";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) { console.error("Missing FOOTBALL_DATA_TOKEN"); process.exit(1); }

// ---- must match index.html exactly (seeded order: positions 1,2,3,4) ----
const GROUPS = {
  A:["Mexico","South Africa","South Korea","Czechia"],
  B:["Canada","Bosnia & Herz.","Qatar","Switzerland"],
  C:["Brazil","Morocco","Haiti","Scotland"],
  D:["United States","Paraguay","Australia","Türkiye"],
  E:["Germany","Curaçao","Ivory Coast","Ecuador"],
  F:["Netherlands","Japan","Sweden","Tunisia"],
  G:["Belgium","Egypt","Iran","New Zealand"],
  H:["Spain","Cape Verde","Saudi Arabia","Uruguay"],
  I:["France","Senegal","Iraq","Norway"],
  J:["Argentina","Algeria","Austria","Jordan"],
  K:["Portugal","DR Congo","Uzbekistan","Colombia"],
  L:["England","Croatia","Ghana","Panama"],
};
const PAIRS = [[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]]; // slot 0..5 -> seeded positions

// ---- normalise any API spelling to our canonical names ----
const norm = s => (s||"").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z]/g,"");
const ALIAS = {};
const add = (canon, ...aliases) => [canon, ...aliases].forEach(a => ALIAS[norm(a)] = canon);
Object.values(GROUPS).flat().forEach(t => add(t));
add("South Korea","Korea Republic","Republic of Korea","Korea, Republic of");
add("Czechia","Czech Republic");
add("Türkiye","Turkey","Turkiye");
add("Iran","IR Iran","Islamic Republic of Iran");
add("Ivory Coast","Côte d'Ivoire","Cote d'Ivoire");
add("Cape Verde","Cabo Verde");
add("United States","USA","United States of America");
add("Bosnia & Herz.","Bosnia and Herzegovina","Bosnia & Herzegovina","Bosnia-Herzegovina");
add("Curaçao","Curacao");
add("DR Congo","Congo DR","Democratic Republic of the Congo","Congo, DR");
const canon = name => ALIAS[norm(name)] || null;

const WHERE = {};
for (const g of Object.keys(GROUPS)) GROUPS[g].forEach((t,i)=>WHERE[t]={g,pos:i});
function slotFor(a,b){
  for (let i=0;i<PAIRS.length;i++){ const [h,k]=PAIRS[i];
    if ((h===a&&k===b)||(h===b&&k===a)) return i; }
  return -1;
}

// stage label -> our bracket round key
const STAGE = {
  LAST_32:"r32", ROUND_OF_32:"r32",
  LAST_16:"r16", ROUND_OF_16:"r16",
  QUARTER_FINALS:"qf", QUARTER_FINAL:"qf",
  SEMI_FINALS:"sf", SEMI_FINAL:"sf",
  THIRD_PLACE:"third", THIRD_PLACE_FINAL:"third",
  FINAL:"f",
};

// keep prior data so we never blank out things the API hasn't published yet
let prev = {};
try { prev = JSON.parse(readFileSync("results.json","utf8")); } catch {}
const results  = prev.results  || Object.fromEntries(Object.keys(GROUPS).map(g=>[g,[null,null,null,null,null,null]]));
const kickoffs = prev.kickoffs || {};
const knockout = { r32:[], r16:[], qf:[], sf:[], f:[], third:[] };

const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
  headers: { "X-Auth-Token": TOKEN }
});
if (!res.ok){ console.error("API error", res.status, await res.text()); process.exit(1); }
const { matches=[] } = await res.json();

const unmatched = new Set();
let placed=0, koMatches=0;

for (const m of matches){
  const stage = (m.stage||"").toUpperCase();
  const home = canon(m.homeTeam?.name), away = canon(m.awayTeam?.name);
  const ft = m.score?.fullTime || {};
  const finished = m.status === "FINISHED" && ft.home!=null && ft.away!=null;

  if (STAGE[stage]) {
    // ----- knockout: only once at least one real team is known -----
    if (!home && !away) continue;
    if (m.homeTeam?.name && !home) unmatched.add(m.homeTeam.name);
    if (m.awayTeam?.name && !away) unmatched.add(m.awayTeam.name);
    knockout[STAGE[stage]].push({
      a: home||"", b: away||"",
      sa: finished?ft.home:"", sb: finished?ft.away:"",
      date: m.utcDate || ""
    });
    koMatches++;
  } else {
    // ----- group stage -----
    if (!home || !away){
      if (m.homeTeam?.name && !home) unmatched.add(m.homeTeam.name);
      if (m.awayTeam?.name && !away) unmatched.add(m.awayTeam.name);
      continue;
    }
    const A=WHERE[home], B=WHERE[away];
    if (!A||!B||A.g!==B.g) continue;
    const i = slotFor(A.pos,B.pos); if (i<0) continue;
    if (m.utcDate) kickoffs[A.g+i] = m.utcDate;
    if (finished){
      const byPos = { [A.pos]:ft.home, [B.pos]:ft.away };
      const [hp,ap]=PAIRS[i];
      results[A.g][i] = [ byPos[hp], byPos[ap] ];
      placed++;
    }
  }
}

for (const k of Object.keys(knockout)) knockout[k].sort((x,y)=>String(x.date).localeCompare(String(y.date)));

if (unmatched.size) console.warn("\u26a0 Unmatched team names (add to ALIAS):", [...unmatched].join(", "));

writeFileSync("results.json", JSON.stringify({
  updatedAt: new Date().toISOString(),
  source: "football-data.org",
  results, kickoffs, knockout
}, null, 2));
console.log(`results.json written \u2014 ${placed} group results, ${Object.keys(kickoffs).length} kick-off times, ${koMatches} knockout matches.`);
