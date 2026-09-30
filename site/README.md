# Hiking Club — website

A static, multi-page site with no framework and no runtime dependencies. GitHub Pages serves the
repo root. Pages are generated from one dataset; assets live in `site/`.

```
index.html, expeditions/, archive/, activities/, the-club/, join/   generated pages (do not edit by hand)
site/data/expeditions.json   the source of truth: the club (founded, members), trips 001–007, activities
site/data/images.json        written by build_assets photos: each photo's sizes, AVIF or not, its placeholder
site/data/derived.json       computed from open elevation data: routes, profiles, terrain, map positions
site/tools/build_assets.py   photos, contour maps, heightmaps, Scandinavia map, least-cost routes, logo
site/tools/build_pages.py    renders every page from the data (shared head, header, footer, menu)
site/assets/css/site.css     the design system
site/assets/js/site.js       the motion system: one rAF loop, scene progress (--p), parallax, maps, rope
site/assets/js/intro.js      picks the opening; itself the cut-paper version (?scene=simple, and without WebGL 2)
site/assets/js/intro-ascent.js  the earlier raymarched version, only loaded with ?scene=ascent
site/assets/js/intro-real.js  the opening (home only): the flight up the Abisko valley in 3D (three.js), reversible
site/assets/js/vendor/three.min.js  three.js r186 (MIT), bundled and minified; used by intro-real.js
site/assets/js/relief.js     the terrain objects: the destinations model (home) and a trip's block with its route
site/assets/js/contours.js   live contour layers: marching squares over the heightmaps, flowing with scroll
```

Rebuild after changing data: `python3 site/tools/build_assets.py routes && python3 site/tools/build_pages.py`.
Serve the root to try it: `python3 -m http.server` (heightmaps are read from canvas, which needs http).

## Before launch — placeholders

| What | Where |
|---|---|
| Club inbox. The form composes an email to it | `build_pages.py`, `data-mailto` in `join()` |
| The planned expeditions 006 Abisko and 007 Sarek: routes, group sizes, costs, itineraries | `site/data/expeditions.json` |
| Which photographs belong to which trip (assigned by guess) | same, `images` of each trip |
| The board: roles are listed, names are "To be announced" | `build_pages.py`, `club()` |
| FAQ answers about fees and allocation | `build_pages.py`, `FAQ` |

Real: coordinates, summit heights, stations and huts, the terrain, the routes' shape and length
(computed from the elevation model), the distance from Sveavägen, the night train.

## Information architecture

| Route | Purpose |
|---|---|
| `/` | The intro, a title card, then an overview: statement and facts, next expedition, the night train north, activities, archive, the club, join |
| `/expeditions/` | Upcoming dossiers (status, dates, difficulty, distance, places), then the completed ones |
| `/expeditions/<no>-<name>/` | One dossier per expedition: facts, route map + elevation profile + stages, terrain model, photographs, field log, packing list, registration |
| `/archive/` | The record by year, as a list or on the map of Scandinavia |
| `/activities/` | Four scenes: hiking, mountaineering, winter, expeditions — season, level, group, equipment, past trips |
| `/the-club/` | SASSE and SSE, philosophy, the three rules, safety, the board, history |
| `/join/` | Who can join, membership, experience, costs, how expeditions work, FAQ, the form |

## The intro

The opening is the 3D flight described below (`intro-real.js`). The cut-paper version described in this
section (`intro.js`) plays with `?scene=simple`, and in browsers without WebGL 2. With
`prefers-reduced-motion` there is only the title card.

It is part of the page: scrolling down plays it, scrolling back up plays it backwards. The first visit
in a tab and every reload start at the top; coming back to Home later in the visit starts on the title
card, with the flight above it. It is a short flight up the Abisko valley, the first day of the next
trip, over the real terrain (the Abisko elevation model): forest by the lake, the valley, the snow on
the tops. The landscape is drawn as layers of cut paper on a 2D canvas at the screen's own resolution,
so it is sharp everywhere and cheap to draw. It opens on a forest trail behind six members walking
in (packs, poles, hats, backlit by a low sun), rises over them and the canopy, and three plain captions
say what the club is. At the end the colour drains out of the layers until only their edges remain, a
contour drawing on paper, and the twin peak at the end of the valley becomes the mark on the title card.
*Skip intro* and *Replay the intro* cut to the end or the start. `?p=0.4` freezes the camera. `?scene=ascent` plays the earlier, raymarched 3D
version (`intro-ascent.js`), kept for comparison.

## The 3D intro (the default)

The same flight, captions and ending, rendered in 3D, with a shorter scroll: 280vh on desktop and
250vh below 860px (180vh and 150vh of pinned travel, respectively). The Abisko elevation model is a CDLOD
terrain with detail below its cells, mountains beyond it and a valley to the club's mountain; spruce and
mountain birch as geometry near the camera and as baked pictures further off (placed once, in a worker,
by the same rule); ground cover, the group of six walking, geese; a low October sun with traced mountain
shadows, tree shadows, light through the leaves and light shafts; mist and haze; ACES tone mapping and a
grade. The mountain at the end has the mark's outline, and a flat copy of it becomes the title card's
logo. Adaptive resolution targets 60 fps; `?p=0.4` freezes it, `?hide=near,rings,terrain,cover,shafts`
leaves parts out for measuring. The forest floor uses photographic colour, OpenGL normal, and packed
AO/roughness maps, fading back to the procedural terrain between 24 and 95 m. The three local WebP maps
total about 557 KiB and load only for this experiment. Trees retain the greener foliage and light
geometry from the tip-fix version. Foliage, people and ground cover remain procedural and limit the
photographic result.

### Where to continue the experiment

- `site.js` provides the shared motion loop and terrain loader. `intro.js` selects the renderer;
  `build_pages.py` gives the experimental module its own content hash so reloads pick up changes.
- `intro-real.js`: `flight()` maps normalised scroll to the camera. The final mountain and its
  transition into the mark live around `HERO` and `heroGeometry()`; captions and the title card are updated
  near the end of the file. `site.css` owns the pinned section length and overlay layout.
- Terrain selection is in `selectNode()` and `updateTerrain()`. A patch's level must match its physical
  size. Shader detail filtering uses world distance, and perimeter skirts close the remaining gaps
  during transitions between resolutions. These three pieces prevent the bright grid seams.
- `spruceGeometry()` supplies both nearby trees and the baked distant sprites. Upper branches taper
  into the thin leader; separate upright texture cards previously made the crowns look forked. The
  photographic conifer atlas and denser branch geometry were reverted because they looked yellow and
  cost more to render. The tip correction remains in both the nearby trees and the distant sprites.
- `terrainMat.onBeforeCompile` blends the photographic floor maps in world coordinates at their 2 m
  scale. Colour modulation retains the existing biome colours, two tile orientations reduce repetition,
  and normal/roughness/AO detail fades out with distance. Water, snow and steep rock retain their materials.
  Failed texture loads retain the procedural fallback. The renderer's own grain is sufficient; the CSS
  grain overlay is disabled for this version.
- `forestAt()` and `treeline()` have matching CPU and GLSL rules. The measured valley retains its
  treeline; the synthetic continuation raises it gradually. `placeFar()` builds the density texture
  through the final mountain, and `RINGS` supplies three distances of trees to cover its approach.

Keep `.intro-stage` clipped with `overflow: clip`: `hidden` makes it internally scrollable when a
translated overlay or focused link extends beyond its bounds, which can shift the canvas inside the
sticky section. Check forward and reverse scrolling, skip/replay, and the mobile breakpoint after edits.
Rebuild pages with `python3 site/tools/build_pages.py` whenever JS or CSS changes, then reload the preview.

## Motion language

Everything is drawn from the club's world, and nothing moves without a reason.

- **Contours** (`contours.js`): the real terrain of Abisko or Kebnekaise, traced live. Scroll shifts the
  contour interval through the terrain so the lines migrate; they part by a few pixels around the pointer;
  a fast scroll stretches them by a hair. Page heads, the statement, Hiking, the mobile menu.
- **The relief** (`relief.js`), the signature object: a sculptural block of real terrain, stone top,
  graphite sides, contours every 50 m. It turns with the scroll and leans towards the pointer. With a
  route, the route draws itself along the ground and the coordinates of its head update.
- **Routes**: Stockholm → destination arcs on the Scandinavia map (home: the night train north, counting
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
   from the school (Lovö, Bogesundslandet, Paradiset, Tyresta, Kungsängen), then Abisko, the first
   expedition north, in planning; each with a link to its trip.
3. The night train on home, drawn along the real line through its stations (1,440 km to Abisko), and
   the route on every trip page, drawn by scrolling.
4. The archive map: photographs grow out of the points.
5. Activities: the terrain drifts (Hiking), the white takes the page (Mountaineering), the page goes
   cold (Winter), every route draws at once (Expeditions).

## System

Colour, type, grid, lines, buttons and reveals are unchanged from V1: paper `#F4F2EE`, ink `#1D1D1B`,
navy `#0B1B2E`, slate, and rope `#D98E3C` only for the climber, routes, the rope and "registering".
Pine `#0E241D` (the identity's Pin tile) is the dark of the northern forest: the footer, the join bands,
the activity list and the Hiking scene; navy stays for safety and the map of expeditions. On pine, the
secondary text is lichen `#9DB5A7` (7.4:1) and rope still passes (6.1:1).
Newsreader for statements, Schibsted Grotesk for information, 12 columns, hairlines, numbered rows.

## Performance

One rAF loop for the whole site, asleep unless something moves; every canvas stops off screen; the
relief renders only when its input changed; heightmaps load as their section comes near
(the intro's is preloaded).

The intro draws each frame in under 10 ms on the CPU and only when the scroll moves it; scrolling through it holds 60 fps on an M4. Photographs come at four widths
(640–1920), AVIF where that is clearly smaller (the grainy ones) and WebP otherwise, lazy, with
dimensions, a `sizes` that allows for `object-fit` cropping, and a blurred 32 px placeholder inline.
The link preview (`assets/img/og.jpg`) is the intro's first frame; `SITE_URL` in `build_pages.py` is
where the site is published (previews need absolute URLs). Scrolling
measures 60 fps on an M4 on every page. `prefers-reduced-motion`: no intro (the title card), no parallax,
routes shown complete, no page-transition animation.

## Credits

Photographs of the club by its members (`club-*`, `forest-*`, `winter-*`); the rest from Wikimedia Commons,
graded and cropped, authors and licences in the footer and `tools/credits.json`. New photos: drop them in
`tools/raw/` as JPEG and run `python3 site/tools/build_assets.py photos` (AVIF needs
`pip install pillow-avif-plugin`; without it the job writes WebP only). Terrain and contours from Mapzen Terrain Tiles on AWS Open Data. The SASSE and SSE logos
(`assets/img/partners/`) are those organisations' own files, taken from sasse.se and hhs.se. Fonts: Newsreader
and Schibsted Grotesk (SIL OFL, licences in `assets/fonts/`).

The 3D experiment uses Poly Haven's [Forest Ground 03](https://polyhaven.com/a/forrest_ground_03)
(Rob Tuytel), under CC0. Sources, original checksums and licence links
are in `tools/real-textures.json` and the site's credits. Rebuild the optimised maps with
`python3 site/tools/build_real_textures.py` (Pillow and curl); verified originals are cached in the ignored
`tools/raw/real-textures/`. Normal and ARM maps are linear data; the colour map and procedural foliage atlas use
sRGB.
