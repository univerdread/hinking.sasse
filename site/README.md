# Hiking Club — website

A static, multi-page site with no framework and no runtime dependencies. GitHub Pages serves the
repo root. Pages are generated from one dataset; assets live in `site/`.

```
index.html, expeditions/, archive/, activities/, the-club/, join/   generated pages (do not edit by hand)
site/data/expeditions.json   the source of truth: expeditions 001–005, activities
site/data/derived.json       computed from open elevation data: routes, profiles, terrain, map positions
site/tools/build_assets.py   photos, contour maps, heightmaps, Scandinavia map, least-cost routes, logo
site/tools/build_pages.py    renders every page from the data (shared head, header, footer, menu)
site/assets/css/site.css     the design system
site/assets/js/site.js       the motion system: one rAF loop, scene progress (--p), parallax, maps, rope
site/assets/js/intro.js      the opening (home only): the Abisko valley as layered vector terrain, plays once
site/assets/js/intro-ascent.js  the earlier raymarched version, only loaded with ?scene=ascent
site/assets/js/relief.js     the terrain objects: the destinations model (home) and a trip's block with its route
site/assets/js/contours.js   live contour layers: marching squares over the heightmaps, flowing with scroll
site/assets/js/rock.js       the granite fragment in Activities → Climbing
```

Rebuild after changing data: `python3 site/tools/build_assets.py routes && python3 site/tools/build_pages.py`.
Serve the root to try it: `python3 -m http.server` (heightmaps are read from canvas, which needs http).

## Before launch — placeholders

| What | Where |
|---|---|
| Club inbox. The form composes an email to it | `build_pages.py`, `data-mailto` in `join()` |
| Dates, group sizes, places left, costs, itineraries, field logs | `site/data/expeditions.json` |
| Expedition 005 Sarek is an announced example | same |
| The board: roles are listed, names are "To be announced" | `build_pages.py`, `club()` |
| FAQ answers about fees and allocation | `build_pages.py`, `FAQ` |

Real: coordinates, summit heights, stations and huts, the terrain, the routes' shape and length
(computed from the elevation model), the distance from Sveavägen, the night train.

## Information architecture

| Route | Purpose |
|---|---|
| `/` | The ascent, a title card, then an overview: statement, next expedition, 1,002 km north, activities, archive, the club, join |
| `/expeditions/` | Upcoming dossiers (status, dates, difficulty, distance, places), then the completed ones |
| `/expeditions/<no>-<name>/` | One dossier per expedition: facts, route map + elevation profile + stages, terrain model, photographs, field log, packing list, registration |
| `/archive/` | The record by year, as a list or on the map of Scandinavia |
| `/activities/` | Five scenes: hiking, climbing, alpine, winter, expeditions — season, level, group, equipment, past trips |
| `/the-club/` | SASSE and SSE, philosophy, the three rules, safety, the board, history |
| `/join/` | Who can join, membership, experience, costs, how expeditions work, FAQ, the form |

## The intro

It plays on load and on every reload; walking back to Home from another page in the same visit goes
straight to the title card. It is a short flight up the Abisko valley, the first day of the next
trip, over the real terrain (the Abisko elevation model): forest by the lake, the valley, the snow on
the tops. The landscape is drawn as layers of cut paper on a 2D canvas at the screen's own resolution,
so it is sharp everywhere and cheap to draw. Three plain captions say what the club is. At the end the
colour drains out of the layers until only their edges remain, a contour drawing on paper, and the
title card forms out of it. The stage then becomes the first screen of the page: its scroll length is
removed in the same frame, without moving what you see. `?intro` replays it (the title card's *Replay
the intro* links there). `?p=0.4` freezes the camera. `?scene=ascent` plays the earlier, raymarched 3D
version (`intro-ascent.js`), kept for comparison.

## Motion language

Everything is drawn from the club's world, and nothing moves without a reason.

- **Contours** (`contours.js`): the real terrain of Abisko or Kebnekaise, traced live. Scroll shifts the
  contour interval through the terrain so the lines migrate; they part by a few pixels around the pointer;
  a fast scroll stretches them by a hair. Page heads, the statement, Hiking, the mobile menu.
- **The relief** (`relief.js`), the signature object: a sculptural block of real terrain, stone top,
  graphite sides, contours every 50 m. It turns with the scroll and leans towards the pointer. With a
  route, the route draws itself along the ground and the coordinates of its head update.
- **Routes**: Stockholm → destination arcs on the Scandinavia map (home: *1,002 km north*, counting
  kilometres and latitude), and trail routes on the area maps, drawn by scrolling through the stages.
  Hover a stage and its segment is picked out on the map.
- **The rope** (the club page): a verlet rope through the three rules, nudged by scroll velocity.
- **Photographs**: they rise out of masks, drift a few pixels behind a fast scroll, and in the
  archive they emerge from their coordinates.
- **Page transitions**: native cross-document View Transitions. The new page rises behind a ridge
  line, the header stays put, and an expedition's photograph and name travel from the list into the
  dossier. Browsers without support navigate normally.

## Moments

1. The flight up the Abisko valley, and the contour drawing it ends in.
2. *From Stockholm, outward.*: one block of land becomes each destination in turn, in order of distance
   from the school (Tyresta, the archipelago, Sarek, Kebnekaise, Abisko), each with a link to its trip.
3. The night train on home, drawn along the real line through its stations (1,440 km to Abisko), and
   the route on every trip page, drawn by scrolling.
4. The archive map: photographs grow out of the points.
5. Activities: the terrain drifts (Hiking), granite crosses the headline (Climbing), the white takes the
   page (Alpine), the page goes cold (Winter), every route draws at once (Expeditions).

## System

Colour, type, grid, lines, buttons and reveals are unchanged from V1: paper `#F4F2EE`, ink `#1D1D1B`,
navy `#0B1B2E`, slate, and rope `#D98E3C` only for the climber, routes, the rope and "registering".
Pine `#0E241D` (the identity's Pin tile) is the dark of the northern forest: the footer, the join bands,
the activity list and the Hiking scene; navy stays for safety and the map of expeditions. On pine, the
secondary text is lichen `#9DB5A7` (7.4:1) and rope still passes (6.1:1).
Newsreader for statements, Schibsted Grotesk for information, 12 columns, hairlines, numbered rows.

## Performance

One rAF loop for the whole site, asleep unless something moves; every canvas stops off screen; the
relief and the rock render only when their input changed; the intro is disposed once it has played.

The intro draws each frame in under 10 ms on the CPU and only when the scroll moves it; scrolling through it holds 60 fps on an M4. Photographs are WebP at two sizes, lazy, with dimensions. Scrolling
measures 60 fps on an M4 on every page. `prefers-reduced-motion`: no intro (the title card), no parallax,
routes shown complete, no page-transition animation.

## Credits

Photographs of the club by its members (`club-*`, `forest-*`, `winter-*`); the rest from Wikimedia Commons,
graded and cropped, authors and licences in the footer and `tools/credits.json`. New photos: drop them in
`tools/raw/` as JPEG and run `python3 site/tools/build_assets.py photos`. Terrain and contours from Mapzen Terrain Tiles on AWS Open Data. The SASSE and SSE logos
(`assets/img/partners/`) are those organisations' own files, taken from sasse.se and hhs.se. Fonts: Newsreader
and Schibsted Grotesk (SIL OFL, licences in `assets/fonts/`).
