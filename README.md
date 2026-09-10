# ParkPlay Minneapolis

A friendlier front door to Minneapolis Park & Recreation Board programs for
kids, built on MPRB's live registration data. One HTML file, one JSON file, no
build step, no framework, no account.

```
index.html               the whole site
data/programs.json       the catalog, refreshed nightly by GitHub Actions
scripts/sync.mjs         pulls the catalog from MPRB's registration system
scripts/build-standalone.mjs   one-file build with the data inlined
```

## Running it

Any static host works, and so does any static server locally:

```bash
npx serve .        # then open the printed URL
node scripts/sync.mjs   # refresh the catalog (needs network access to ActiveNet)
```

Opening `index.html` straight off disk will not work: browsers block a local
page from fetching a local JSON file, and the page says so if you try.

## What you can do with it

- Filter by age, category, weekday, distance, open spots, free, starting soon
- **Save anything with one tap.** Every program row has a heart. It works with
  no kid added and no account: the program lands in My plan straight away, and
  you can put a name to it later from a dropdown on the saved row. The count in
  the nav shows how many you are holding.
- Rank all locations by distance, then pick the three preferred rec centers the
  real registration form asks for
- A six-question quiz scored against what is actually open at your kid's age
- My plan: a week grid with overlap warnings across kids, calendar export, a
  copy-as-text summary, and every registration link in one place
- A last-refreshed stamp in the footer and in the top bar, written as how long
  ago rather than a bare timestamp, with a warning if the nightly sync stalls
- Everything lives in `localStorage`, so there is nothing to sign into and
  nothing leaves the browser

## Where the data comes from

MPRB runs youth registration through ActiveNet, branded "MPRB Online
Recreation Services". Its front end is a single-page app that calls a JSON API.
`scripts/sync.mjs` talks to it the same way that app does:

1. `GET /mplsparkandrec/activity/search?…` for session cookies and the CSRF
   token the app shell mints into `window.__csrfToken`.
2. `POST /mplsparkandrec/rest/activities/list` with that token, those cookies
   and a `page_info` header, filtered to `max_age=17`. Roughly 1,150 activities
   across 58 pages.
3. Every location name is resolved to coordinates through Nominatim and cached
   in `data/geocache.json`, so repeat runs make no geocoding calls.

The endpoint was found by driving MPRB's own search page in headless Chromium
and recording its network traffic. Guessing the REST path returns the app shell
with HTTP 200, which is why a wrong guess looks like it worked.

TeamSideline still carries MPRB's adult leagues and the per-sport youth rule
bulletins, but its current-programs page no longer lists youth programs.

## What the sync cleans up

- **Categories.** Sports get their own; so do the arts, cooking, preschool,
  school-release-day, camp, teen, event and outdoors programs that make up most
  of the catalog. Sports match on the title only, so a family movie night that
  mentions the rink in its description is not filed under hockey.
- **Ages.** `At least 4 but less than 6½`, `Grades: 1st - 5th`, `15 and up` and
  `Any` all arrive as free text and become numeric ranges.
- **Divisions.** Read from league titles (6U, 8U, 11U, 13U, 15U, 18U, or a grade
  range), never guessed from an age window.
- **Citywide leagues.** Team sport registrations have no single site: their
  location field reads "Practices at neighborhood facilities…" because staff
  place the team from the three preferred centers you choose at signup. Those
  are flagged and routed to the map's site picker instead of being handed a
  fake address.
- **Audience.** Adult leagues that happen to allow all ages are tagged and kept
  out of the kids' lists.

## Design notes

Strict geometry underneath, loose ink on top. An 8pt spacing scale, a fixed
type hierarchy and ordinary list and card patterns carry the layout; the
hand-drawn parts sit around the functional elements rather than over them.

- **Palette.** Warm paper (`#FAF7F2`) with one saturated track per activity
  family: tangerine for sports, cobalt for ice and water, mint for outdoors and
  racquets, poppy for arts, sunny for little-kid and event programs, grape for
  teens and dance. The catch-all track is blank paper.
- **Type.** Fraunces (soft, slightly wonky) for display, Plus Jakarta Sans for
  everything functional, Caveat for margin notes only. Ages, times, dates,
  spots and fees are never set in a novelty face.
- **Linework.** Every drawing is plain SVG primitives run through one shared
  `feTurbulence` + `feDisplacementMap` filter, so the strokes wobble like crayon
  without hand-jittering path data. Twenty-six doodle icons, one per category.
- **Handmade accents.** Asymmetric squircle radii, 2px ink borders with hard
  offset shadows, dashed rules, a wavy section divider, a highlight swoosh under
  the headline, a compass rose, and a two-frame wobble on hover that respects
  `prefers-reduced-motion`.

## Known gaps

- **Fee amounts.** The list API returns "View fee details" rather than a number
  for most programs, so exact fees show as a link to the MPRB page. Free
  programs do come through as free, and youth fees are fully discountable at
  checkout for Minneapolis residents.
- **Freshness.** Spot counts are as of the last nightly sync, so confirm a
  nearly-full program before counting on it.
- **One location.** A location MPRB calls "multi-purpose room" cannot be
  geocoded, so it lists without a distance.

Not affiliated with or endorsed by the Minneapolis Park & Recreation Board.
Registration, payment, refunds and fee assistance all happen on MPRB's site.
