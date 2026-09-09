/**
 * Pull the real MPRB youth activity catalog from ActiveNet and write
 * data/programs.json for the site.
 *
 * ActiveNet's front end talks to POST /rest/activities/list with a session
 * cookie and the CSRF token minted by the app shell, so we do the same.
 * Park coordinates come from Nominatim, cached in data/geocache.json so
 * repeat runs make no geocoding calls.
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";

const BASE = "https://anc.apm.activecommunities.com/mplsparkandrec";
const SHELL = `${BASE}/activity/search?onlineSiteId=0&activity_select_param=2&max_age=17&viewMode=list&locale=en-US`;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const PER_PAGE = 100;
const MAX_AGE = 17;

const jar = new Map();
function stash(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookies = () => [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ");

async function req(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "user-agent": UA, accept: "*/*", cookie: cookies(), ...(opts.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  stash(res);
  return res;
}

/* Offline mode: replay a captured API response so the normalizer can be
   exercised without network access (PARKPLAY_FIXTURE=probe-out/....json). */
const FIXTURE = process.env.PARKPLAY_FIXTURE || "";

/* ---------- session ---------- */
let csrfToken = "";
if (!FIXTURE) {
const shellRes = await req(SHELL, { headers: { accept: "text/html" } });
const shellHtml = await shellRes.text();
csrfToken = (shellHtml.match(/__csrfToken\s*=\s*"([^"]+)"/) || [])[1] || "";
if (!csrfToken) throw new Error("no CSRF token in the ActiveNet app shell");
console.log(`session established · csrf ${csrfToken.slice(0, 8)}… · ${jar.size} cookies`);
}
const csrf = csrfToken;

const apiHeaders = (page) => ({
  "content-type": "application/json;charset=utf-8",
  "x-csrf-token": csrf,
  origin: "https://anc.apm.activecommunities.com",
  referer: SHELL,
  page_info: JSON.stringify({ order_by: "", page_number: page, total_records_per_page: PER_PAGE }),
});

/* ---------- filter metadata ---------- */
if (!FIXTURE) {
  const filtersRes = await req(`${BASE}/rest/activities/filters?locale=en-US`, { headers: { "x-csrf-token": csrf } });
  const meta = (await filtersRes.json()).body || {};
  console.log(`filters · ${(meta.centers || []).length} centers · ${(meta.categories || []).length} categories · ${(meta.seasons || []).length} seasons`);
}

/* ---------- every activity a kid could be signed up for ---------- */
const searchPattern = {
  skills: [], time_after_str: "", days_of_week: null, activity_select_param: 2,
  center_ids: [], time_before_str: "", open_spots: null, activity_id: null,
  activity_category_ids: [], date_before: "", min_age: null, date_after: "",
  activity_type_ids: [], site_ids: [], for_map: false, geographic_area_ids: [],
  season_ids: [], activity_department_ids: [], activity_other_category_ids: [],
  child_season_ids: [], activity_keyword: "", instructor_ids: [], max_age: MAX_AGE,
  custom_price_from: "", custom_price_to: "",
};

const raw = [];
if (FIXTURE) {
  const captured = JSON.parse(await readFile(FIXTURE, "utf8"));
  const payload = typeof captured.body === "string" ? JSON.parse(captured.body) : captured;
  raw.push(...(payload.body?.activity_items || payload.activity_items || []));
  console.log(`fixture ${FIXTURE} · ${raw.length} activities`);
}
let page = 1, totalPages = FIXTURE ? 0 : 1;
while (!FIXTURE && page <= totalPages) {
  const res = await req(`${BASE}/rest/activities/list?locale=en-US`, {
    method: "POST",
    headers: apiHeaders(page),
    body: JSON.stringify({ activity_search_pattern: searchPattern, activity_transfer_pattern: {} }),
  });
  const json = await res.json();
  const info = json.headers?.page_info || {};
  totalPages = info.total_page || 1;
  const items = json.body?.activity_items || [];
  raw.push(...items);
  console.log(`page ${page}/${totalPages} · ${items.length} activities (${raw.length}/${info.total_records || "?"})`);
  page += 1;
}

/* ---------- classification ---------- */
/* Sports first, most specific wins; then the other things MPRB runs, because
   a parent looking for something for Thursday night cares about those too. */
const CATEGORIES = [
  ["basketball", /basketball|hoops|dribbl/i],
  ["soccer", /soccer|futsal|kickers|little kicks/i],
  ["hockey", /hockey/i],
  ["skating", /learn to skate|skating|skate school|ice skat/i],
  ["volleyball", /volleyball/i],
  ["football", /football|nfl flag|flag ?football|punt pass/i],
  ["baseball", /baseball|t-?ball|tee ?ball|\bRBI\b/i],
  ["softball", /softball/i],
  ["wrestling", /wrestl/i],
  ["gymnastics", /gymnastic|tumbl|cheer/i],
  ["track", /track|cross country|running club|\brun\b/i],
  ["lacrosse", /lacrosse/i],
  ["tennis", /tennis|pickleball|badminton|racquet/i],
  ["swim", /swim|water safety|aquatic|dive|scuba/i],
  ["golf", /golf|disc golf/i],
  ["archery", /archery/i],
  ["martialarts", /karate|taekwondo|judo|martial|jiu.?jitsu|boxing/i],
  ["dance", /dance|ballet|hip ?hop|zumba/i],
  ["multisport", /multi.?sport|all.?stars|sports sampler|ultimate sports|fundamental sports|sport sampler|dodgeball|kickball|gaga/i],
  ["outdoors", /ski|snowboard|snowshoe|fishing|kayak|canoe|paddle|bike|cycling|climbing|nature|hike|campfire|garden|birding|archery range/i],
  ["fitness", /open gym|drop ?in|pick.?up|fitness|yoga|weight|cardio|walking club/i],
  ["arts", /art|ceramic|pottery|clay|paint|draw|craft|studio|music|piano|guitar|choir|sing|theater|theatre|podcast|photo|sew|knit|jewelry|candle|makers|maker/i],
  ["cooking", /bake|baking|chef|cookie|cooking|pretzel|gingerbread|butter making|pizza|culinary/i],
  ["preschool", /preschool|pre-?k|toddler|storytime|indoor playground|tot |tot-|little learners|early childhood/i],
  ["schoolout", /school release|school.?s out|school out|no school|break camp|kids night out|dinner and a movie|movie night|late start|early release/i],
  ["camps", /camp\b|camps\b/i],
  ["teen", /teen|youthline|middle school night|high school night|dungeons|d&d/i],
  ["events", /celebration|festival|party|halloween|holiday|solstice|contest|carnival|dia de|d[ií]as de|open house|community (sing|dinner|meal)|trunk or treat/i],
];
/* Sports are claimed by title only. A family movie night whose description
   happens to mention the hockey rink is not a hockey program. */
const SPORT_KEYS = new Set(["basketball","soccer","hockey","skating","volleyball","football",
  "baseball","softball","wrestling","gymnastics","track","lacrosse","tennis","swim","golf",
  "archery","martialarts","multisport","dance"]);
function classify(name, blurb) {
  for (const [key, re] of CATEGORIES) if (re.test(name)) return key;
  for (const [key, re] of CATEGORIES) {
    if (SPORT_KEYS.has(key)) continue;
    if (re.test(blurb.slice(0, 220))) return key;
  }
  return "other";
}

const ENTITIES = {"&amp;":"&","&nbsp;":" ","&#39;":"'","&rsquo;":"’","&lsquo;":"‘","&quot;":'"',
  "&ldquo;":'“',"&rdquo;":'”',"&mdash;":"—","&ndash;":"–","&#189;":"½","&frac12;":"½","&#188;":"¼","&#190;":"¾","&lt;":"<","&gt;":">"};
function decode(str) {
  return String(str || "").replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}
const stripTags = (s) => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/* "Armatage Park, Maude D." -> "Armatage Park" */
const cleanParkName = (label) => decode(label || "")
  .replace(/,\s*[A-Z][a-z]*\.?\s*[A-Z]?\.?$/, "")
  .replace(/\s+/g, " ")
  .trim();

const GRADE_WORDS = {k:0, kindergarten:0, pre:-1, prek:-1};
function gradeNum(token) {
  const t = String(token).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t in GRADE_WORDS) return GRADE_WORDS[t];
  const m = /^(\d+)/.exec(t);
  return m ? Number(m[1]) : null;
}

/* MPRB writes age windows several different ways; normalize them all. */
function parseAges(item) {
  const text = decode(item.ages || item.age_description || "");
  const out = {ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, agesText: text};

  const grades = /grades?\s*:?\s*([A-Za-z0-9]+)\s*(?:-|–|to|through)\s*([A-Za-z0-9]+)/i.exec(text);
  if (grades) {
    out.gradeMin = gradeNum(grades[1]);
    out.gradeMax = gradeNum(grades[2]);
    if (out.gradeMin != null) out.ageMin = out.gradeMin + 5;
    if (out.gradeMax != null) out.ageMax = out.gradeMax + 7;
    return out;
  }
  if (item.min_grade != null || item.max_grade != null) {
    out.gradeMin = gradeNum(item.min_grade);
    out.gradeMax = gradeNum(item.max_grade);
  }
  const minYear = item.age_min_year, maxYear = item.age_max_year;
  if (typeof minYear === "number" && minYear > 0) out.ageMin = minYear;
  if (typeof maxYear === "number" && maxYear > 0 && maxYear < 100) out.ageMax = maxYear;
  if (out.ageMin == null && /less than\s*(\d+)/i.test(text)) out.ageMin = 0;
  return out;
}

const YOUTH_WORDS = /youth|kid|child|teen|preschool|pre-?k|junior|jr\.?|little|tot\b|toddler|storytime|6u|8u|11u|13u|15u|18u|grade|boys|girls|all.?stars|family/i;
const ADULT_WORDS = /^adult|^women'?s|^men'?s|\b55\+|\bseniors?\b/i;
function audienceOf(name, ages) {
  if (ADULT_WORDS.test(name)) return "adult";
  if (ages.gradeMax != null) return "youth";
  if (ages.ageMax != null && ages.ageMax <= 19) return "youth";
  if (ages.ageMin != null && ages.ageMin >= 18) return "adult";
  if (YOUTH_WORDS.test(name)) return "youth";
  return "any";
}

/* Only the league listings have divisions. A ceramics class does not, so this
   reads the title rather than guessing from an age range. */
function divisionOf(name) {
  const m = /\b(6U|8U|10U|11U|12U|13U|14U|15U|18U)\b/i.exec(name);
  if (m) return m[1].toUpperCase();
  const grade = /\b(\d+)(?:st|nd|rd|th)\s*(?:&|and|-|to)?\s*(?:(\d+)(?:st|nd|rd|th))?\s*grade/i.exec(name);
  if (grade) return grade[2] ? `grades ${grade[1]}-${grade[2]}` : `grade ${grade[1]}`;
  return null;
}

/* Citywide league registrations name no single site: MPRB places the kid after
   registration closes, based on the three preferred centers you pick. */
const CITYWIDE = /citywide|various mprb|neighborhood facilities|will be played at|^n\/a$|^tbd$/i;
function isCitywide(label) {
  if (!label) return true;
  return CITYWIDE.test(label) || label.length > 46;
}

/* ---------- parks + coordinates ---------- */
let geocache = {};
try { geocache = JSON.parse(await readFile("data/geocache.json", "utf8")); } catch { /* first run */ }

const parkLabels = [...new Set(raw.map((a) => cleanParkName(a.location?.label)).filter((l) => l && !isCitywide(l)))];
console.log(`distinct locations in use: ${parkLabels.length}`);

let seed = [];
try { seed = JSON.parse(await readFile("data/parks.seed.json", "utf8")); } catch { /* optional */ }
const seedByName = new Map(seed.map((p) => [p.name.toLowerCase(), p]));

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const parks = [];
for (const label of parkLabels) {
  const id = slug(label);
  const bare = label.replace(/\s+(park|recreation center|rec center|community center|school|field)\b.*$/i, "").trim();
  const seeded = seedByName.get(bare.toLowerCase()) || seedByName.get(label.toLowerCase());
  let entry = geocache[label];
  /* Retry anything that failed before; park names get renamed and cleaned up. */
  if (entry && !entry.lat && !FIXTURE) entry = null;
  if (!entry && FIXTURE) entry = { lat: null, lng: null, source: "skipped-offline" };
  if (!entry) {
    /* MPRB writes location names as staff know them: honorifics, gym names,
       "Field Park", parenthetical renames. Try progressively plainer forms. */
    const plain = label
      .replace(/\((?:formerly|previously)[^)]*\)/gi, "")
      .replace(/\b(?:Rev\.?|Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s*/gi, "")
      .replace(/,?\s*Jr\.?,?/gi, " ")
      .replace(/\b(?:Multi|Multi-purpose|Gym|Gymnasium|Room|Lot|Headquarters)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s*,\s*$/, "")
      .trim();
    const core = plain.replace(/\b(?:Field\s+Park|Recreation Center|Rec Center|Community Center|Regional Park|Park)\b/gi, "").trim();
    const queries = [];
    const add = (q) => { if (q && q.length > 4 && queries.indexOf(q) < 0) queries.push(q); };
    add(`${label}, Minneapolis, MN`);
    if (seeded?.addr) add(`${seeded.addr}, Minneapolis, MN`);
    if (plain !== label) add(`${plain}, Minneapolis, MN`);
    if (core) add(`${core} Park, Minneapolis, Minnesota`);
    if (core) add(`${core} Recreation Center, Minneapolis, Minnesota`);
    if (bare && bare !== label) add(`${bare} Park, Minneapolis, MN`);
    entry = { lat: null, lng: null, source: "miss" };
    for (const query of queries) {
      try {
        const res = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(query), {
          headers: { "user-agent": "parkplay-sync/1.0 (github.com/pragerd/toronto-40th)" },
          signal: AbortSignal.timeout(20_000),
        });
        const hits = await res.json();
        const hit = Array.isArray(hits) ? hits[0] : null;
        if (hit) {
          entry = { lat: Number(hit.lat), lng: Number(hit.lon), source: "nominatim", query, display: hit.display_name };
          break;
        }
      } catch (err) {
        entry = { lat: null, lng: null, source: "error", error: err.message };
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
    console.log(`geocode ${label} -> ${entry.lat ?? "MISS"}`);
    geocache[label] = entry;
    await new Promise((r) => setTimeout(r, 1100));
  }
  parks.push({
    id, name: label, address: seeded?.addr || null, area: seeded?.area || null,
    lat: entry.lat, lng: entry.lng, geo: entry.source,
  });
}
await mkdir("data", { recursive: true });
await writeFile("data/geocache.json", JSON.stringify(geocache, null, 2));

/* ---------- normalize ---------- */
const programs = raw.map((a) => {
  const rawLabel = cleanParkName(a.location?.label);
  const citywide = isCitywide(rawLabel);
  const parkLabel = citywide ? null : rawLabel;
  const name = stripTags(a.name);
  const blurb = stripTags(a.desc);
  const ages = parseAges(a);
  return {
    id: a.id,
    number: a.number,
    name,
    category: classify(name, blurb),
    audience: audienceOf(name, ages),
    ageMin: ages.ageMin,
    ageMax: ages.ageMax,
    gradeMin: ages.gradeMin,
    gradeMax: ages.gradeMax,
    ages: ages.agesText,
    division: divisionOf(name),
    citywide,
    citywideNote: citywide ? (rawLabel || null) : null,
    parkId: parkLabel ? slug(parkLabel) : null,
    parkLabel: parkLabel || null,
    days: a.days_of_week || "",
    time: a.time_range || "",
    dateStart: a.date_range_start || null,
    dateEnd: a.date_range_end || null,
    dateRange: decode(a.date_range || ""),
    oneDay: !!a.only_one_day,
    openings: a.openings === "" || a.openings == null ? null : Number(a.openings),
    capacity: a.total_open ?? null,
    enrolled: a.already_enrolled ?? null,
    feeLabel: decode(a.fee?.label || ""),
    feeFrom: a.search_from_price ?? null,
    enrollUrl: a.enroll_now?.href || a.action_link?.href || null,
    detailUrl: a.detail_url || null,
    blurb: blurb.slice(0, 420),
  };
});

const counts = programs.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
console.log("\nby category:", Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
const geoMissing = parks.filter((p) => !p.lat).length;
console.log(`parks: ${parks.length} (${geoMissing} without coordinates)`);
const byAudience = programs.reduce((m, p) => ((m[p.audience] = (m[p.audience] || 0) + 1), m), {});
console.log("by audience:", JSON.stringify(byAudience));
console.log(`citywide league listings: ${programs.filter((p) => p.citywide).length} · with a division: ${programs.filter((p) => p.division).length}`);

const payload = JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: {
    system: "ActiveNet — MPRB Online Recreation Services",
    endpoint: `${BASE}/rest/activities/list`,
    filter: `max_age=${MAX_AGE}`,
    records: programs.length,
  },
  parks: parks.sort((a, b) => a.name.localeCompare(b.name)),
  programs: programs.sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2) + "\n";

if (FIXTURE) {
  /* Never let a 20-record fixture overwrite the real catalog. */
  await writeFile("data/programs.fixture.json", payload);
  console.log(`wrote data/programs.fixture.json · ${programs.length} programs · ${parks.length} parks`);
} else {
  await writeFile("data/programs.json", payload);
  console.log(`wrote data/programs.json · ${programs.length} programs · ${parks.length} parks`);
}
