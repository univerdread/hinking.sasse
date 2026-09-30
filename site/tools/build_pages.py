#!/usr/bin/env python3
"""Renders every page of the site from data/expeditions.json (+ data/derived.json from build_assets.py).

    python3 site/tools/build_pages.py

Output goes to the repo root, where GitHub Pages serves it: index.html, expeditions/, archive/,
activities/, the-club/, join/. Pages use relative URLs so the site works under any base path.
"""
import html, json, math, re
from pathlib import Path
from PIL import Image

SITE = Path(__file__).resolve().parent.parent
ROOT = SITE.parent
IMG = SITE / "assets/img"
DATA = json.loads((SITE / "data/expeditions.json").read_text())
DER = json.loads((SITE / "data/derived.json").read_text())
EXP = DATA["expeditions"]
BY = {e["no"]: e for e in EXP}
ACT = DATA["activities"]
esc = html.escape

STATUS = {"registering": "Registering", "announced": "Announced", "completed": "Completed"}
SSE = (59.3417, 18.0572)


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def deg(v, pos, neg):
    return f"{abs(v):.4f}° {pos if v >= 0 else neg}"


def coords(e, sep=" "):
    return f'{deg(e["lat"], "N", "S")}{sep}{deg(e["lon"], "E", "W")}'


def km(v):
    return f"{v:,.0f}" if v >= 20 else f"{v:,.1f}".rstrip("0").rstrip(".")


# ------------------------------------------------------------------ fragments
def u(d, path=""):
    """Relative URL from a page `d` folders deep."""
    return "../" * d + path


def img(d, name, alt, sizes="100vw", cls="", eager=False, vt=None, w=None):
    small = Image.open(IMG / f"{name}-960.webp").size
    big = Image.open(IMG / f"{name}-1920.webp").size
    vt_s = f' style="view-transition-name: {vt}"' if vt else ""
    return (f'<img{f" class={chr(34)}{cls}{chr(34)}" if cls else ""} src="{u(d)}site/assets/img/{name}-1920.webp" '
            f'srcset="{u(d)}site/assets/img/{name}-960.webp {small[0]}w, {u(d)}site/assets/img/{name}-1920.webp {big[0]}w" '
            f'sizes="{sizes}" width="{big[0]}" height="{big[1]}" {"fetchpriority=\"high\"" if eager else "loading=\"lazy\""} '
            f'decoding="async" alt="{esc(alt)}"{vt_s}>')


def logo(d, name, cls, tone="paper"):
    """SASSE's and SSE's own logos, from their own files, in paper (on dark) or ink (on light)."""
    alt = {"sasse-logo": "SASSE, the Student Association at the Stockholm School of Economics", "sse-logo": "Stockholm School of Economics"}[name]
    vb = {"sasse-logo": (120, 95), "sse-logo": (288, 57)}[name]
    return f'<img class="{cls}" src="{u(d)}site/assets/img/partners/{name}-{tone}.svg" width="{vb[0]}" height="{vb[1]}" alt="{alt}" loading="lazy">'


def sprite():
    sym = []
    for sid, f in [("mark", "logo-mark"), ("wordmark", "logo-wordmark"), ("lockup", "logo-vertical"), ("lockup-h", "logo-horizontal")]:
        svg = (IMG / f"{f}.svg").read_text()
        vb = re.search(r'viewBox="([^"]+)"', svg).group(1)
        inner = re.sub(r"^<svg[^>]*>|</svg>$", "", svg)
        sym.append(f'<symbol id="{sid}" viewBox="{vb}" fill="currentColor">{inner}</symbol>')
    return '<svg class="sprite" aria-hidden="true" style="position:absolute;width:0;height:0">' + "".join(sym) + "</svg>"


SPRITE = sprite()
NAV = [("expeditions/", "Expeditions"), ("archive/", "Archive"), ("activities/", "Activities"), ("the-club/", "The Club"), ("join/", "Join")]


def ver(rel):
    """A short hash of an asset's content, appended to its URL so a browser never keeps an old copy."""
    import hashlib
    return hashlib.sha1((SITE / "assets" / rel).read_bytes()).hexdigest()[:8]


def head(d, title, desc, page, scripts=()):
    js = "".join(f'<script defer src="{u(d)}site/assets/js/{s}.js?v={ver(f"js/{s}.js")}"></script>' for s in dict.fromkeys(("site", "contours", *scripts)))
    return f"""<!doctype html>
<html lang="en" class="page-{page}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="theme-color" content="#F4F2EE">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:image" content="{u(d)}site/assets/img/abisko-lapporten-figure-1920.webp">
<link rel="icon" href="{u(d)}site/assets/img/logo-mark.svg" type="image/svg+xml">
<link rel="preload" href="{u(d)}site/assets/fonts/newsreader.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{u(d)}site/assets/fonts/schibsted-grotesk.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{u(d)}site/assets/css/site.css?v={ver("css/site.css")}">
<script>document.documentElement.classList.add('js');</script>
{js}
</head>
<body data-root="{u(d)}">
{SPRITE}
<a class="skip" href="#main">Skip to content</a>
"""


def header(d, current):
    nxt = next(e for e in EXP if e["status"] == "registering")
    links = "".join(
        f'<a href="{u(d, p)}"{" aria-current=" + chr(34) + "page" + chr(34) if current == p else ""}><span class="nav-no tnum">0{i + 1}</span><span class="nav-t">{t}</span></a>'
        for i, (p, t) in enumerate(NAV))
    return f"""<header class="nav" data-nav>
  <a class="nav-brand" href="{u(d) or './'}" aria-label="Hiking Club, home">
    <svg class="nav-mark" viewBox="0 0 171 138" aria-hidden="true"><use href="#mark"/></svg>
    <svg class="nav-word" viewBox="0 0 169.1 15.2" aria-hidden="true"><use href="#wordmark"/></svg>
  </a>
  <nav class="nav-links" id="nav-links" aria-label="Main">
    <canvas class="nav-contours" data-contours="abisko" data-alpha="0.10" aria-hidden="true"></canvas>
    {links}
    <a class="nav-next" href="{u(d, 'expeditions/' + nxt['slug'] + '/')}"><span class="label">Next · Exp. {nxt['no']}</span><span class="nav-next-name">{nxt['name']}</span><span class="label tnum">{nxt['dates']}</span></a>
  </nav>
  <a class="nav-sasse" href="https://www.sasse.se" rel="noopener">SASSE<span aria-hidden="true">↗</span></a>
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links"><span>Menu</span></button>
</header>
"""


def credits_html():
    lic = {"CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/", "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
           "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/", "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
           "CC0": "https://creativecommons.org/publicdomain/zero/1.0/", "Public domain": "https://en.wikipedia.org/wiki/Public_domain"}
    # only the photographs the site shows: the expeditions' and the activities' (the club's own need none)
    used = {e["images"]["hero"] for e in EXP} | {n for e in EXP for n, *_ in e["images"]["gallery"]} | {a["img"] for a in ACT}
    items = []
    for name, c in json.loads((SITE / "tools/credits.json").read_text()).items():
        if name not in used:
            continue
        title = c["title"].removeprefix("File:").rsplit(".", 1)[0]
        items.append(f'<li><a href="{esc(c["page"])}" rel="noopener">{esc(title)}</a>, {esc(c["artist"] or "unknown")}, '
                     f'<a href="{lic[c["lic"]]}" rel="noopener">{c["lic"]}</a>. Graded and cropped.</li>')
    return '<ul class="credits-list">' + "".join(items) + "</ul>"


CREDITS = credits_html()


def footer(d):
    nxt = next(e for e in EXP if e["status"] == "registering")
    return f"""<footer class="footer" data-theme="pine">
  <div class="footer-top">
    <svg class="footer-logo" viewBox="0 0 304.4 100" role="img" aria-label="Hiking Club"><use href="#lockup-h"/></svg>
    <p class="footer-line">Leave no trace.</p>
  </div>
  <div class="footer-cols">
    <div><p class="label">Hiking Club</p><p>A student club of SASSE, the Student Association at the Stockholm School of Economics.</p></div>
    <div><p class="label">Address</p><p>Stockholm School of Economics<br>Sveavägen 65<br>113 83 Stockholm</p></div>
    <div><p class="label">Site</p><p>{"<br>".join(f'<a class="link" href="{u(d, p)}">{t}</a>' for p, t in NAV)}</p></div>
    <div><p class="label">Elsewhere</p><p><a class="link" href="https://www.sasse.se" rel="noopener">SASSE</a><br><a class="link" href="https://www.hhs.se" rel="noopener">Stockholm School of Economics</a></p>
      <details class="credits"><summary class="label">Photo credits</summary>{CREDITS}<p class="small">Photographs of the club by its members. Contours and terrain from Mapzen Terrain Tiles on AWS Open Data. The SASSE and Stockholm School of Economics logos belong to their owners.</p></details></div>
  </div>
  <div class="footer-orgs">
    <a class="footer-org" href="https://www.sasse.se" rel="noopener">{logo(d, "sasse-logo", "footer-sasse")}</a>
    <a class="footer-org" href="https://www.hhs.se" rel="noopener">{logo(d, "sse-logo", "footer-sse")}</a>
  </div>
  <div class="footer-bottom label"><span>© 2026 Hiking Club</span><a href="{u(d, 'expeditions/' + nxt['slug'] + '/')}" class="tnum">Exp. {nxt['no']} — {nxt['name']} — {nxt['dates']}</a></div>
</footer>
</body>
</html>
"""


def rowhead(no, title, meta, h2=False):
    t = f'<h2>{title}</h2>' if h2 else f"<span>{title}</span>"
    return f'<div class="rowhead" data-reveal><span>{no}</span>{t}<span>{meta}</span></div>'


def grade(n):
    return '<span class="grade" aria-hidden="true">' + "".join(f'<i{" class=" + chr(34) + "on" + chr(34) if i < n else ""}></i>' for i in range(5)) + "</span>"


def status_tag(e):
    extra = {"registering": f" · {e.get('placesLeft', '')} places left", "announced": f" · opens {e.get('opens', '')}", "completed": ""}[e["status"]]
    return f'<span class="status status--{e["status"]}"><i aria-hidden="true"></i>{STATUS[e["status"]]}{esc(extra)}</span>'


def route_km(e):
    r = DER.get("routes", {}).get(e["slug"])
    return r["km"] if r else e["distance_km"]


def exp_url(d, e):
    return u(d, f"expeditions/{e['slug']}/")


def log_row(d, e, cls=""):
    """The archive row: opens on hover from its centre line onto the photograph."""
    return f"""<li class="log-item{cls}">
  <a href="{exp_url(d, e)}">
    <span class="log-img" aria-hidden="true" style="background-image: url({u(d)}site/assets/img/{e['images']['hero']}-960.webp)"></span>
    <span class="log-no tnum">{e['no']}</span>
    <span class="log-name">{esc(e['name'])}</span>
    <span class="log-coord">{esc(e["region"])}</span>
    <span class="log-alt tnum">+{e['high_m']:,} m</span>
    <span class="log-cat">{esc(e['category'])}</span>
    <span class="log-date tnum">{e['short']}</span>
    <span class="log-plus log-up" aria-hidden="true">→</span>
  </a>
</li>"""


# Scandinavia: the base map is an <img> (cached across pages), routes and markers an inline overlay
RAIL_KM = 1440   # Stockholm C – Abisko by rail: about 1,500 km to Narvik, less the 58 km from Abisko


def scandi_overlay(d, focus=None, routes=True, mode="north", rail=False):
    S = DER["scandinavia"]; w, h = S["w"], S["h"]
    sx, sy = S["stockholm"]
    out = [f'<svg class="scandi-overlay" viewBox="0 0 {w} {h}" aria-hidden="true">']
    if rail:
        R = S["rail"]
        out.append(f'<path class="scandi-arctic" d="M{" L".join(f"{x} {y}" for x, y in R["arctic"]["line"])}"/>'
                   f'<text class="scandi-arctic-label" x="{R["arctic"]["line"][1][0] + 6}" y="{R["arctic"]["line"][1][1] - 8}">Arctic Circle</text>')
        out.append(f'<path class="scandi-route scandi-rail is-focus" pathLength="1" d="M{" L".join(f"{x} {y}" for x, y in R["path"])}"/>')
        for st in R["stops"][1:-1]:
            if st["label"]:
                out.append(f'<g class="scandi-stop" data-t="{st["t"]}" transform="translate({st["x"]} {st["y"]})"><circle r="2.6"/><text x="-10" y="4" text-anchor="end">{esc(st["name"])}</text></g>')
    for e in EXP:
        x, y = S["points"][e["slug"]]
        if routes and not rail and (focus is None or e["no"] == focus):
            # a quiet arc bowing west, like a line drawn with a ruler that gave way
            mx, my = (sx + x) / 2, (sy + y) / 2
            dx, dy = x - sx, y - sy
            L = math.hypot(dx, dy) or 1
            cx, cy = mx + dy / L * L * 0.18, my - dx / L * L * 0.18
            out.append(f'<path class="scandi-route{" is-focus" if e["no"] == focus else ""}" pathLength="1" d="M{sx:.1f} {sy:.1f} Q{cx:.1f} {cy:.1f} {x:.1f} {y:.1f}"/>')
    for e in EXP:
        x, y = S["points"][e["slug"]]
        out.append(f'<g class="scandi-pt scandi-pt--{e["status"]}" data-no="{e["no"]}" transform="translate({x} {y})"><circle r="3.2"/><circle class="scandi-ring" r="9"/>'
                   f'<text x="14" y="4">{e["no"]} {esc(e["name"])}</text></g>')
    out.append(f'<g class="scandi-home" transform="translate({sx} {sy})"><rect x="-3.5" y="-3.5" width="7" height="7"/><text x="12" y="4">Stockholm · SSE</text></g>')
    out.append("</svg>")
    return "".join(out)


def scandi(d, focus=None, routes=True, cls="", rail=False):
    S = DER["scandinavia"]
    alt = "Map of Sweden with the night train's route from Stockholm to Abisko." if rail else "Map of Scandinavia: coastline and mountain contours."
    return (f'<div class="scandi {cls}" style="aspect-ratio: {S["w"]} / {S["h"]}">'
            f'<img class="scandi-base" src="{u(d)}site/assets/map/scandinavia.svg" width="{S["w"]}" height="{S["h"]}" loading="lazy" alt="{alt}">'
            f'{scandi_overlay(d, focus, routes, rail=rail)}</div>')


def relief(d, name, route=None, mode="object", label=True):
    t = DER["terrain"][name]
    r = DER["routes"].get(route) if route else None
    attrs = {"data-relief": name, "data-min": t["min"], "data-max": t["max"], "data-km": ",".join(map(str, t["km"])), "data-mode": mode,
             "data-src": f"{u(d)}site/assets/terrain/{name}.png"}
    if r:
        attrs["data-route"] = json.dumps(r["uv"], separators=(",", ":"))
        attrs["data-ll"] = json.dumps(r["ll"], separators=(",", ":"))
        attrs["data-t"] = json.dumps(r["t"], separators=(",", ":"))
        attrs["data-route-km"] = r["km"]
    a = " ".join(f"{k}='{v}'" if k.startswith("data-r") or k in ("data-ll", "data-t") else f'{k}="{v}"' for k, v in attrs.items())
    lab = ('<p class="relief-read label tnum" aria-hidden="true"><span data-relief-ll>—</span><span data-relief-alt>—</span></p>' if label else "")
    return f'<figure class="relief relief--{mode}"><canvas {a} aria-hidden="true"></canvas>{lab}</figure>'


def contours(name, alpha=0.12, cls="", flow="scroll"):
    t = DER["terrain"][name]
    return (f'<canvas class="contours {cls}" data-contours="{name}" data-min="{t["min"]}" data-max="{t["max"]}" '
            f'data-alpha="{alpha}" data-flow="{flow}" aria-hidden="true"></canvas>')


def photos(d, no, title, meta, items, theme="paper", h2=None):
    """The club's own photographs: a row of three to five, each keeping its own shape."""
    figs = "".join(f'<figure class="strip-item strip-item--{shape} frame" data-reveal="image">{img(d, n, alt, "(min-width: 900px) 30vw, 100vw")}'
                   f'{f"<figcaption>{esc(cap)}</figcaption>" if cap else ""}</figure>' for n, shape, alt, cap in items)
    head_ = f'<h2 class="h-lg strip-h" data-lines>{h2}</h2>' if h2 else ""
    return f"""<section class="section strip" data-theme="{theme}" aria-label="{esc(title)}">
  {rowhead(no, title, meta)}
  {head_}
  <div class="strip-row">{figs}</div>
</section>"""


# ------------------------------------------------------------------ home
def intro():
    t = DER["terrain"]["abisko"]
    return f"""<section id="intro" class="intro" aria-labelledby="intro-title">
  <div class="intro-stage" id="top">
    <canvas data-src="site/assets/terrain/abisko.png" data-min="{t["min"]}" data-max="{t["max"]}" data-km="{t["km"][0]},{t["km"][1]}" aria-hidden="true"></canvas>
    <div class="intro-grain" aria-hidden="true"></div>

    <div class="intro-title">
      <h1 id="intro-title"><svg class="intro-lockup" viewBox="0 0 332 242.9" role="img" aria-label="Hiking Club"><use href="#lockup"/></svg></h1>
      <p>SASSE <span aria-hidden="true">·</span> Stockholm School of Economics</p>
    </div>

    <div class="intro-top">
      <span class="intro-top-mark"><svg viewBox="0 0 171 138" aria-hidden="true"><use href="#mark"/></svg>Hiking Club</span>
      <a class="intro-skip" href="#main">Skip intro</a>
    </div>

    <ol class="intro-lines" aria-hidden="true">
      <li data-at="0.09 0.33">The hiking and outdoor club of the Student Association at the Stockholm School of Economics.</li>
      <li data-at="0.37 0.6">Day hikes around Stockholm, climbing through the year, and expeditions to the Swedish mountains.</li>
      <li data-at="0.64 0.84">Open to every SSE student. No experience required.</li>
    </ol>
    <div class="intro-cue" aria-hidden="true"><span>Scroll</span><i></i></div>

    <div class="intro-end" tabindex="-1">
      <svg class="intro-end-lockup" viewBox="0 0 332 242.9" role="img" aria-label="Hiking Club"><use href="#lockup"/></svg>
      <p class="intro-end-sasse">SASSE <span aria-hidden="true">·</span> Stockholm School of Economics</p>
      <span class="intro-end-line" aria-hidden="true"></span>
      <a class="intro-end-replay label" href="./?intro">Replay the intro</a>
    </div>
  </div>
</section>
"""


# the places the destinations model visits, in order of distance from the school
TOUR = {"001": ("tyresta", 0.5), "003": ("archipelago", 0.5), "005": ("sarek", None), "002": ("kebnekaise", None), "004": ("abisko", 352)}


def tour(d):
    places, caps = [], []
    for e in sorted((BY[n] for n in TOUR), key=lambda e: hav(SSE, (e["lat"], e["lon"]))):
        name, water = TOUR[e["no"]]
        t = DER["terrain"][name]
        dist = hav(SSE, (e["lat"], e["lon"]))
        far = f"{round(dist, -1):,.0f} km north" if dist > 300 else f"{round(dist, -1):,.0f} km from SSE"
        length = f'{e["days"]} days' if e["days"] > 1 else "Day hike"
        when = {"registering": f'Next trip · {e["dates"]}', "announced": f'Planned · {e["dates"]}', "completed": e["dates"]}[e["status"]]
        places.append(dict(src=u(d, f"site/assets/terrain/{name}.png"), min=t["min"], max=t["max"], km=t["km"], water=water))
        caps.append(f'<li data-tour-cap><a href="{exp_url(d, e)}"><span class="label tnum">{e["no"]} · {length} · {far}</span>'
                    f'<span class="tour-name">{esc(e["name"])}</span><span class="tour-when small">{when}</span></a></li>')
    return esc(json.dumps(places, separators=(",", ":"))), "".join(caps)


def home():
    d = 0
    nxt = BY["004"]
    S = DER["scandinavia"]
    acts = "".join(f'<li data-act="{i}"><a href="{u(d, "activities/")}#{a["key"]}"><span class="tnum">0{i + 1}</span><span class="disc-word">{a["name"]}</span>'
                   f'<span class="disc-meta label">{esc(a["season"])} · {esc(a["level"])}</span></a></li>' for i, a in enumerate(ACT))
    shots = "".join(f'<figure class="disc-shot frame" data-act="{i}" data-vt="act-{a["key"]}">{img(d, a["img"], a["name"], "(min-width: 900px) 40vw, 100vw")}</figure>' for i, a in enumerate(ACT))
    rows = "".join(log_row(d, BY[n]) for n in ("002", "003", "001"))
    tour_json, tour_caps = tour(d)
    return (head(d, "Hiking Club — SASSE, Stockholm School of Economics",
                 "Hiking Club is the outdoor club of SASSE, the Student Association at the Stockholm School of Economics. Day trails, rock, ice and the long way north.",
                 "home", ("contours", "relief", "intro"))
            + header(d, "") + intro() + f"""
<main id="main">

<section class="statement" data-theme="paper" aria-labelledby="st-title">
  <div class="statement-track scene" data-scene>
  <div class="statement-pin">
    {contours("kebnekaise", 0.07, "statement-contours")}
    <figure class="relief relief--statement"><canvas data-tour='{tour_json}' aria-hidden="true"></canvas></figure>
    <h2 id="st-title" class="display statement-h">
      <span class="statement-a" data-lines>From Stockholm,</span>
      <span class="statement-b" data-lines><em>outward.</em></span>
    </h2>
    <ol class="tour-caps">{tour_caps}</ol>
  </div>
  </div>
  <div class="statement-body">
    <dl class="facts" data-reveal>
      <div><dd class="tnum">2026</dd><dt>Founded</dt></div>
      <div><dd class="tnum">{len(ACT)}</dd><dt>Activities</dt></div>
      <div><dd class="tnum">{len([e for e in EXP if e["status"] == "completed"])}</dd><dt>Trips completed</dt></div>
      <div><dd class="tnum">{RAIL_KM:,}<small>km</small></dd><dt>North by night train</dt></div>
    </dl>
    <div class="statement-text">
      <p class="lead" data-reveal>Hiking Club is the hiking and outdoor club of SASSE, the Student Association at the Stockholm School of Economics.</p>
      <p data-reveal>We organise day hikes around Stockholm, climbing throughout the year, and trips to the Swedish mountains. Every trip is planned and led by experienced members, and beginners are always welcome.</p>
    </div>
  </div>
</section>

<section class="section next" data-theme="paper" aria-labelledby="next-title">
  {rowhead("01", "Next trip", status_tag(nxt))}
  <a class="next-card" href="{exp_url(d, nxt)}">
    <figure class="next-img frame" data-reveal="image"><div class="para" data-speed="0.08">{img(d, nxt["images"]["hero"], "A single hiker in a red jacket on snow facing Lapporten.", "(min-width: 900px) 62vw, 100vw", vt="exp-004")}</div></figure>
    <div class="next-meta">
      <p class="label">Expedition <span class="tnum">{nxt["no"]}</span></p>
      <h3 id="next-title" class="h-xl" data-lines>{nxt["name"]}</h3>
      <dl class="next-dl tnum" data-reveal>
        <div><dt>Where</dt><dd>{esc(nxt["region"])}</dd></div>
        <div><dt>Dates</dt><dd>{nxt["dates"]}</dd></div>
        <div><dt>Difficulty</dt><dd>{grade(nxt["difficulty"])}{nxt["difficultyLabel"]}</dd></div>
        <div><dt>Distance</dt><dd>{km(route_km(nxt))} km over {nxt["days"]} days</dd></div>
      </dl>
      <span class="btn btn-ink" data-reveal>Read more<span class="btn-arrow" aria-hidden="true">→</span></span>
    </div>
  </a>
</section>

<section class="north scene" data-scene data-theme="paper" aria-labelledby="north-title">
  <div class="north-pin">
    <div class="north-text">
      {rowhead("02", "Getting there", "By night train")}
      <h2 id="north-title" class="h-lg"><span class="tnum" data-north-km>0</span> km by night train.</h2>
      <p class="north-lead">Our mountain trips start at the school. The night train leaves Stockholm Central in the evening and arrives in Abisko, north of the Arctic Circle, the next morning.</p>
      <dl class="north-read" aria-hidden="true">
        <div><dt>Departs</dt><dd>Stockholm C, evening</dd></div>
        <div><dt>Arrives</dt><dd>Abisko, next morning</dd></div>
        <div><dt>Journey</dt><dd>About 17 hours</dd></div>
      </dl>
    </div>
    <div class="north-map" data-north data-km="{RAIL_KM}">{scandi(d, "004", True, rail=True)}</div>
  </div>
</section>

<section class="home-disc scene" data-scene data-theme="pine" aria-labelledby="disc-title">
  <div class="disc-pin">
    {rowhead("03", "What we do", "Five activities", h2=True)}
    <div class="disc-grid">
      <ol class="disc-words" id="disc-title-list">{acts}</ol>
      <div class="disc-stage" aria-hidden="true">{shots}</div>
    </div>
    <a class="link home-more" href="{u(d, "activities/")}">All activities →</a>
  </div>
</section>

<section class="section home-archive" data-theme="paper" aria-labelledby="arch-title">
  {rowhead("04", "Past trips", str(len([e for e in EXP if e["status"] == "completed"])) + " completed")}
  <h2 id="arch-title" class="h-lg" data-lines>Where we have been.</h2>
  <ol class="log">{rows}</ol>
  <a class="link home-more" href="{u(d, "archive/")}">All past trips →</a>
</section>

<section class="section home-club" data-theme="paper" aria-labelledby="club-title">
  {rowhead("05", "The club", "Part of SASSE", h2=True)}
  <div class="lockup" data-reveal>
    <svg class="lockup-mark" viewBox="0 0 332 242.9" role="img" aria-label="Hiking Club"><use href="#lockup"/></svg>
    <span class="lockup-x" aria-hidden="true">×</span>
    <a class="lockup-org" href="https://www.sasse.se" rel="noopener">{logo(d, "sasse-logo", "lockup-sasse-logo", "ink")}</a>
  </div>
  <p class="club-lead" data-reveal>Hiking Club is a student club within SASSE. It is run by students, open to every SASSE member, and part of the wider community of clubs and committees at the Stockholm School of Economics.</p>
  <div class="strip-row strip-row--home">
    <figure class="strip-item strip-item--tall frame" data-reveal="image">{img(d, "club-spruce-file", "The group walking single file through a spruce forest.", "(min-width: 900px) 24vw, 100vw")}</figure>
    <figure class="strip-item strip-item--wide frame" data-reveal="image">{img(d, "club-lake-cliff", "Members on a granite ledge above a forest lake.", "(min-width: 900px) 46vw, 100vw")}</figure>
    <figure class="strip-item strip-item--tall frame" data-reveal="image">{img(d, "club-pine-trail", "Members on a trail through sunlit pines.", "(min-width: 900px) 24vw, 100vw")}</figure>
  </div>
  <a class="link home-more" href="{u(d, "the-club/")}">About the club →</a>
</section>

{join_band(d)}
</main>
""" + footer(d))


def join_band(d):
    return f"""<section class="section join-band" data-theme="pine" aria-labelledby="join-title">
  {rowhead("06", "Join", "Season 2026–27")}
  <h2 id="join-title" class="display display-join" data-lines>Join the<br><em>club.</em></h2>
  <div class="join-band-cta" data-reveal>
    <a class="btn btn-snow" href="{u(d, "join/")}">Become a member<span class="btn-arrow" aria-hidden="true">→</span></a>
    <a class="link" href="{u(d, "expeditions/")}">See upcoming trips</a>
  </div>
</section>"""


def page_head(d, no, label, title, lead, terrain=None, extra=""):
    bg = contours(terrain, 0.09, "page-contours") if terrain else ""
    return f"""<section class="page-head" data-theme="paper">
  {bg}
  <div class="page-head-in">
    <p class="label page-crumb"><a href="{u(d) or './'}">Hiking Club</a> <span aria-hidden="true">/</span> {label}</p>
    <h1 class="display" data-lines>{title}</h1>
    <p class="page-lead" data-reveal>{lead}</p>
    {extra}
  </div>
</section>"""


# ------------------------------------------------------------------ expeditions
def expeditions():
    d = 1
    up = [e for e in EXP if e["status"] != "completed"]
    past = [e for e in EXP if e["status"] == "completed"]
    rows = []
    for e in up:
        rows.append(f"""<li class="dossier-row" data-reveal>
  <a href="{exp_url(d, e)}">
    <figure class="dossier-row-img frame">{img(d, e["images"]["hero"], "", "(min-width: 900px) 34vw, 100vw", vt="exp-" + e["no"])}</figure>
    <span class="dossier-row-no label tnum">Exp. {e["no"]}</span>
    <span class="dossier-row-name" style="view-transition-name: name-{e["no"]}">{esc(e["name"])}</span>
    <span class="dossier-row-coord label">{esc(e["region"])}</span>
    <span class="dossier-row-date">{e["dates"]}</span>
    <span class="dossier-row-status">{status_tag(e)}</span>
    <dl class="dossier-row-dl tnum">
      <div><dt>Difficulty</dt><dd>{grade(e["difficulty"])}{e["difficultyLabel"]}</dd></div>
      <div><dt>Distance</dt><dd>{km(route_km(e))} km</dd></div>
      <div><dt>High point</dt><dd>+{e["high_m"]:,} m</dd></div>
      <div><dt>Group</dt><dd>{e["group"]}{" · " + str(e["placesLeft"]) + " left" if e.get("placesLeft") else ""}</dd></div>
    </dl>
  </a>
</li>""")
    return (head(d, "Expeditions — Hiking Club", "Upcoming Hiking Club expeditions: dates, difficulty, distance, places left.", "expeditions", ("contours",))
            + header(d, "expeditions/") + '<main id="main">'
            + page_head(d, "01", "Expeditions", "Upcoming<br><em>trips.</em>",
                        "From day hikes near Stockholm to week-long trips in the mountains. Every trip has its own page with dates, difficulty, route and packing list.", "abisko")
            + f"""<section class="section exp-up" data-theme="paper" aria-labelledby="up-title">
  {rowhead("01", "Upcoming", f"{len(up)} trips")}
  <h2 id="up-title" class="visually-hidden">Upcoming expeditions</h2>
  <ol class="dossier-rows">{"".join(rows)}</ol>
</section>
<section class="section exp-past" data-theme="paper" aria-labelledby="past-title">
  {rowhead("02", "Completed", f"{len(past)} trips")}
  <h2 id="past-title" class="h-lg" data-lines>Past trips.</h2>
  <ol class="log">{"".join(log_row(d, e) for e in reversed(past))}</ol>
  <a class="link home-more" href="{u(d, "archive/")}">All past trips, on the map →</a>
</section>
{join_band(d)}
</main>""" + footer(d))


def expedition(e):
    d = 2
    r = DER["routes"].get(e["slug"])
    i = EXP.index(e)
    prev_e, next_e = EXP[i - 1] if i else None, EXP[i + 1] if i + 1 < len(EXP) else None
    dist = hav(SSE, (e["lat"], e["lon"]))
    spec = [("Dates", e["dates"]), ("Status", status_tag(e)), ("Difficulty", grade(e["difficulty"]) + f'{e["difficultyLabel"]}, {e["difficulty"]} of 5'),
            ("Terrain", esc(e["terrain"])), ("Distance", f'{km(route_km(e))} km' + (" over " + str(e["days"]) + " days" if e["days"] > 1 else "")),
            ("Ascent", f'+{(r["gain"] if r else e["ascent_m"]):,} m'), ("High point", f'+{e["high_m"]:,} m, {esc(e["highName"])}'),
            ("Group", f'{e["group"]}' + (f' — {e["placesLeft"]} places left' if e.get("placesLeft") else "")),
            ("Getting there", esc(e["transport"])), ("From SSE", f"{km(dist)} km in a straight line"), ("Weather", esc(e["climate"]))]
    if e.get("leaders"): spec.append(("Leaders", esc(e["leaders"])))
    if e.get("cost"): spec.append(("Cost", esc(e["cost"])))
    spec_html = "".join(f"<div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in spec)

    route_html = ""
    if r:
        W, H = r["w"], r["h"]
        pts = " ".join(f"{x},{y}" for x, y in r["path"])
        stages = e.get("itinerary") or [{"day": "Route", "title": f"{e['name']}, the way we went", "text": e["note"], "range": [0, len(e["route"]) - 1]}]
        # a stop at each end of each day: where the route is at that fraction of its length
        def at_t(t):
            k = next((j for j in range(len(r["t"]) - 1) if r["t"][j + 1] >= t), len(r["t"]) - 2)
            a, b = r["path"][k], r["path"][k + 1]; f = (t - r["t"][k]) / ((r["t"][k + 1] - r["t"][k]) or 1)
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
        bounds = [r["marks"][stages[0]["range"][0]]] + [r["marks"][min(s_["range"][1], len(r["marks"]) - 1)] for s_ in stages]
        names = ["Start"] + ([s_["day"].replace("Day ", "D") for s_ in stages] if e.get("itinerary") else ["Top"])
        if abs(bounds[-1] - 1) < 1e-3 and abs(bounds[0]) < 1e-3 and e["route"][0] == e["route"][-1]: names[-1] = names[-1] + " · End"
        marks = "".join(f'<g class="rt-stop" data-stop="{k}" transform="translate({at_t(t)[0]:.1f} {at_t(t)[1]:.1f})"><circle r="5"/><text x="12" y="4">{nm}</text></g>'
                        for k, (t, nm) in enumerate(zip(bounds, names)) if not (k == len(bounds) - 1 and e["route"][0] == e["route"][-1]))
        prof = r["profile"]; lo, hi = min(prof), max(prof)
        pw, ph = 1000, 180
        ppts = " ".join(f"{k / (len(prof) - 1) * pw:.1f},{ph - (v - lo) / (hi - lo) * (ph - 24) - 4:.1f}" for k, v in enumerate(prof))
        st_html = []
        for k, s in enumerate(stages):
            a, b = r["marks"][s["range"][0]], r["marks"][min(s["range"][1], len(r["marks"]) - 1)]
            skm = (b - a) * r["km"]
            st_html.append(f"""<li class="stage" data-stage="{k}" data-a="{a}" data-b="{b}">
  <p class="label tnum">{s["day"]} · {km(skm)} km</p>
  <h3>{esc(s["title"])}</h3>
  <p class="stage-way label">{esc(s.get("from", ""))}{" → " + esc(s["to"]) if s.get("to") else ""}</p>
  <p>{esc(s["text"])}</p>
</li>""")
        route_html = f"""<section class="route scene" data-scene data-theme="paper" aria-labelledby="route-title">
  <div class="route-in">
    <div class="route-map">
      <div class="route-map-pin">
        <div class="route-map-frame" style="aspect-ratio: {W} / {H}">
          <img src="{u(d)}site/assets/map/{r["map"]}.svg" width="{W}" height="{H:.0f}" loading="lazy" alt="Contour map of the {esc(e["name"])} area.">
          <svg class="route-svg" viewBox="0 0 {W} {H}" aria-hidden="true" data-route-svg>
            <polyline class="route-all" points="{pts}"/>
            <polyline class="route-line" points="{pts}" pathLength="1"/>
            {marks}
            <g class="route-head"><circle r="7"/><circle r="2.5" class="route-head-dot"/></g>
          </svg>
        </div>
        <div class="profile" aria-hidden="true" data-profile="{json.dumps(prof)}" data-km="{r['km']}">
          <svg viewBox="0 0 {pw} {ph}" preserveAspectRatio="none"><polygon class="profile-area" points="0,{ph} {ppts} {pw},{ph}"/><polyline class="profile-line" points="{ppts}"/><rect class="profile-cover" x="0" y="0" width="{pw}" height="{ph}"/></svg>
          <p class="profile-lab label tnum"><span>+{lo:,} m</span><span data-route-read>0.0 km · +{prof[0]:,} m</span><span>+{hi:,} m</span></p>
        </div>
      </div>
    </div>
    <div class="route-text">
      {rowhead("02", "Route", f"{km(r['km'])} km · +{r['gain']:,} m", h2=False)}
      <h2 id="route-title" class="h-lg" data-lines>The route.</h2>
      <ol class="stages">{"".join(st_html)}</ol>
    </div>
  </div>
</section>"""

    relief_html = ""
    if e.get("relief"):
        relief_html = f"""<section class="section dossier-relief" data-theme="paper" aria-label="Terrain model">
  {rowhead("03", "Terrain", f"{DER['terrain'][e['relief']]['km'][0]:.0f} × {DER['terrain'][e['relief']]['km'][1]:.0f} km · {DER['terrain'][e['relief']]['min']:,}–{DER['terrain'][e['relief']]['max']:,} m")}
  <div class="scene dossier-relief-scene" data-scene>{relief(d, e["relief"], e["slug"], "dossier")}</div>
  <p class="small dossier-relief-cap">A terrain model of the area, built from open elevation data, with the route drawn in as you scroll. Heights are exaggerated 1.6 times.</p>
</section>"""

    log_html = ""
    if e.get("log"):
        log_html = f"""<section class="section field-log" data-theme="paper" aria-labelledby="log-title">
  {rowhead("04", "Trip report", e["dates"])}
  <h2 id="log-title" class="h-lg" data-lines>How it went.</h2>
  <ol class="log-times">{"".join(f'<li data-reveal><span class="label tnum">{t}</span><p>{esc(x)}</p></li>' for t, x in e["log"])}</ol>
</section>"""

    pack_html = ""
    if e.get("packing"):
        pack_html = f"""<section class="section packing" data-theme="paper" aria-labelledby="pack-title">
  {rowhead("05", "Packing list", f"{len(e['packing'])} items")}
  <h2 id="pack-title" class="h-lg" data-lines>What to bring.</h2>
  <ul class="pack">{"".join(f'<li data-reveal><span class="pack-box" aria-hidden="true"></span>{esc(x)}</li>' for x in e["packing"])}</ul>
</section>"""

    gallery = "".join(f'<figure class="gal-item frame" data-reveal="image">{img(d, n, cap, "(min-width: 900px) 45vw, 100vw")}<figcaption><b>{no}</b> {esc(cap)}</figcaption></figure>'
                      for n, no, cap in e["images"]["gallery"][1:])
    cta = {"registering": f'<a class="btn btn-snow" href="{u(d, "join/")}?trip={e["no"]}">Register for {e["no"]}<span class="btn-arrow" aria-hidden="true">→</span></a><p class="small">Registration closes {e.get("closes", "")}. {e.get("placesLeft", "")} of {e["group"]} places left.</p>',
           "announced": f'<p class="h-lg">Registration opens {e.get("opens", "")}.</p><a class="btn btn-snow" href="{u(d, "join/")}">Become a member to hear first<span class="btn-arrow" aria-hidden="true">→</span></a>',
           "completed": f'<p class="h-lg">Completed, {e["short"]}.</p><a class="btn btn-snow" href="{u(d, "expeditions/")}">See upcoming trips<span class="btn-arrow" aria-hidden="true">→</span></a>'}[e["status"]]
    pn = (f'<a class="pn pn-prev" href="{exp_url(d, prev_e)}"><span class="label">← Exp. {prev_e["no"]}</span><span class="pn-name">{esc(prev_e["name"])}</span></a>' if prev_e else "<span></span>") + \
         (f'<a class="pn pn-next" href="{exp_url(d, next_e)}"><span class="label">Exp. {next_e["no"]} →</span><span class="pn-name">{esc(next_e["name"])}</span></a>' if next_e else "<span></span>")
    title = f'Expedition {e["no"]} — {e["name"]} — Hiking Club'
    return (head(d, title, f'{e["name"]}, {e["dates"]}. {e["note"]}', "expedition", ("relief",) if e.get("relief") else ())
            + header(d, "expeditions/") + f"""<main id="main">
<section class="exp-hero" data-theme="paper" aria-labelledby="exp-title">
  <div class="exp-hero-head">
    <p class="label page-crumb"><a href="{u(d, "expeditions/")}">Expeditions</a> <span aria-hidden="true">/</span> Exp. {e["no"]}</p>
    <h1 id="exp-title" class="h-xl" style="view-transition-name: name-{e["no"]}">{esc(e["name"])}</h1>
    <p class="exp-hero-coord label">{esc(e["region"])}</p>
    <p class="exp-hero-date">{e["dates"]}</p>
    <p class="exp-hero-status">{status_tag(e)}</p>
  </div>
  <figure class="exp-hero-img frame">{img(d, e["images"]["hero"], e["images"]["gallery"][0][2], "100vw", eager=True, vt="exp-" + e["no"])}<figcaption><b>{e["images"]["gallery"][0][1]}</b> {esc(e["images"]["gallery"][0][2])}</figcaption></figure>
</section>
<section class="section exp-facts" data-theme="paper" aria-labelledby="facts-title">
  {rowhead("01", "Overview", esc(e["region"]))}
  <div class="exp-facts-in">
    <h2 id="facts-title" class="exp-note" data-reveal>{esc(e["note"])}</h2>
    <dl class="spec" data-reveal>{spec_html}</dl>
  </div>
</section>
{route_html}
{relief_html}
{f'<section class="section gallery" data-theme="paper" aria-label="Photographs"><div class="gal">{gallery}</div></section>' if gallery else ""}
{log_html}
{pack_html}
<section class="section exp-cta" data-theme="pine">
  {rowhead("06", "Exp. " + e["no"], STATUS[e["status"]])}
  <div class="exp-cta-in" data-reveal>{cta}</div>
  <nav class="pn-row" aria-label="Other expeditions">{pn}</nav>
</section>
</main>""" + footer(d))


# ------------------------------------------------------------------ archive
def archive():
    d = 1
    years = sorted({e["year"] for e in EXP}, reverse=True)
    groups = []
    for y in years:
        es = [e for e in EXP if e["year"] == y]
        groups.append(f'<li class="year"><p class="year-no label tnum">{y}</p><ol class="log">{"".join(log_row(d, e, "" if e["status"] == "completed" else " log-next") for e in reversed(es))}</ol></li>')
    cards = "".join(f"""<a class="amap-card" data-card="{e["no"]}" href="{exp_url(d, e)}" tabindex="-1" aria-hidden="true">
  <span class="amap-photo">{img(d, e["images"]["hero"], "", "22vw")}</span>
  <span class="label tnum">{e["no"]} · {e["short"]}</span><span class="amap-name">{esc(e["name"])}</span>
  <span class="label">{esc(e["region"])}</span></a>""" for e in EXP)
    links = "".join(f'<li><a href="{exp_url(d, e)}" data-hover="{e["no"]}"><span class="tnum">{e["no"]}</span> {esc(e["name"])}</a></li>' for e in EXP)
    return (head(d, "Archive — Hiking Club", "Every trip Hiking Club has made, by year and on the map, with photographs.", "archive", ("contours",))
            + header(d, "archive/") + '<main id="main">'
            + page_head(d, "02", "Archive", "Past<br><em>trips.</em>", "Every trip the club has made, listed by year and shown on the map.", "kebnekaise",
                        '<div class="view-toggle" role="group" aria-label="View"><button type="button" class="label" aria-pressed="true" data-view="list">List</button><button type="button" class="label" aria-pressed="false" data-view="map">Map</button></div>')
            + f"""<section class="section archive-body" data-theme="paper" data-view-root="list" aria-label="Expeditions">
  <div class="archive-list"><ol class="years">{"".join(groups)}</ol></div>
  <div class="archive-map">
    <div class="amap">{scandi(d, None, True, "scandi--archive")}{cards}</div>
    <ol class="amap-index">{links}</ol>
  </div>
</section>
{join_band(d)}
</main>""" + footer(d))


# ------------------------------------------------------------------ activities
def activities():
    d = 1
    scenes = []
    for i, a in enumerate(ACT):
        past = "".join(f'<li><a class="link" href="{exp_url(d, BY[n])}"><span class="tnum">{n}</span> {esc(BY[n]["name"])}</a></li>' for n in a["past"])
        meta = f"""<dl class="act-dl" data-reveal>
  <div><dt>Season</dt><dd>{a["season"]}</dd></div><div><dt>Experience</dt><dd>{a["level"]}</dd></div>
  <div><dt>Group</dt><dd class="tnum">{a["group"]}</dd></div><div><dt>Equipment</dt><dd>{a["equipment"]}</dd></div>
</dl>{f'<div class="act-past" data-reveal><p class="label">Past</p><ul>{past}</ul></div>' if past else ""}"""
        env = {"hiking": contours("abisko", 0.16, "act-contours"),
               "climbing": '<canvas class="rock" data-rock aria-hidden="true"></canvas>',
               "alpine": '<div class="act-white" aria-hidden="true"></div>',
               "winter": '<canvas class="snowfall" data-snow aria-hidden="true"></canvas>',
               "expeditions": f'<div class="act-map">{scandi(d, None, True, "scandi--act")}</div>'}[a["key"]]
        scenes.append(f"""<section id="{a["key"]}" class="act act--{a["key"]} scene" data-scene data-theme="{ {"expeditions": "navy", "hiking": "pine"}.get(a["key"], "paper") }" aria-labelledby="act-{a["key"]}">
  <div class="act-pin">
    {env}
    <figure class="act-img frame"><div class="para" data-speed="0.06">{img(d, a["img"], "", "(min-width: 900px) 46vw, 100vw", vt="act-" + a["key"])}</div></figure>
    <div class="act-text">
      <p class="label tnum">0{i + 1} / 0{len(ACT)}</p>
      <h2 id="act-{a["key"]}" class="act-h">{a["name"]}</h2>
      <p class="act-lead" data-reveal>{esc(a["text"])}</p>
      {meta}
    </div>
  </div>
</section>""")
    return (head(d, "Activities — Hiking Club", "Hiking, climbing, alpine trips, winter activities and expeditions with Hiking Club at SASSE.", "activities", ("contours", "rock"))
            + header(d, "activities/") + '<main id="main">'
            + page_head(d, "03", "Activities", "What we<br><em>do.</em>", "Hiking, climbing, alpine trips, winter activities and expeditions. Each has its own season, level and equipment list.", None,
                        '<ol class="act-index label">' + "".join(f'<li><a href="#{a["key"]}"><span class="tnum">0{i + 1}</span> {a["name"]}</a></li>' for i, a in enumerate(ACT)) + "</ol>")
            + "".join(scenes) + join_band(d) + "</main>" + footer(d))


# ------------------------------------------------------------------ the club
RULES = [("I", "The group sets the pace."), ("II", "Safety comes before<br>the summit."), ("III", "Leave no trace.")]


def club():
    d = 1
    first = min(EXP, key=lambda e: e["no"])
    hist = "".join(f'<li data-reveal><span class="label tnum">{e["short"]}</span><span class="hist-no tnum">{e["no"]}</span><span class="hist-name">{esc(e["name"])}</span><span class="small">{esc(e["category"])}</span></li>' for e in EXP)
    rules = "".join(f'<section class="rule-scene" aria-label="Principle {n}"><p class="rule-no label">Principle {n}</p><p class="rule-text">{t}</p></section>' for n, t in RULES)
    return (head(d, "The Club — Hiking Club", "About Hiking Club, a student club of SASSE at the Stockholm School of Economics: who we are, how we work, and how we keep trips safe.", "club", ("contours",))
            + header(d, "the-club/") + '<main id="main">'
            + page_head(d, "04", "The club", "About the<br><em>club.</em>", "Hiking Club is a student-run club within SASSE, the Student Association at the Stockholm School of Economics.", "kebnekaise",
                        f"""<div class="lockup lockup--head" data-reveal><svg class="lockup-mark" viewBox="0 0 332 242.9" role="img" aria-label="Hiking Club"><use href="#lockup"/></svg><span class="lockup-x" aria-hidden="true">×</span><a class="lockup-org" href="https://www.sasse.se" rel="noopener">{logo(d, "sasse-logo", "lockup-sasse-logo", "ink")}</a></div>""")
            + f"""<section class="section club-about" data-theme="paper" aria-labelledby="about-title">
  {rowhead("01", "About us", "Part of SASSE")}
  <h2 id="about-title" class="club-lead" data-reveal>Hiking Club gets students at the Stockholm School of Economics outdoors, from day hikes near the city to trips in the Swedish mountains.</h2>
  <div class="club-cols">
    <div data-reveal><p class="label">SASSE</p><p>SASSE is the Student Association at the Stockholm School of Economics. Hiking Club is one of its clubs: our members are SASSE members, and the board reports to SASSE and follows its statutes.</p></div>
    <div data-reveal><p class="label">Stockholm School of Economics</p><p>Most trips start from the school at Sveavägen 65. Longer trips usually leave on a Thursday or Friday evening by night train.</p></div>
    <div data-reveal><p class="label">Our approach</p><p>Small groups, experienced leaders and enough time. Every trip is planned in advance, and safety always comes first.</p></div>
  </div>
</section>

""" + photos(d, "—", "On the trail", "Photographs by members", [
        ("club-lake-cliff", "wide", "Members on a granite ledge above a forest lake.", "Above the lake."),
        ("forest-autumn-shore", "tall", "A member walking along an autumn lakeshore.", "Along the lakeshore in autumn."),
        ("winter-fur-hat", "wide", "A fur hat hung on ski poles in the snow at night.", "A night stop on a winter trip."),
        ("winter-last-light", "wide", "Last light over a snowbound spruce forest.", "Evening in the winter forest."),
    ], theme="pine") + f"""

<section class="manifesto-seq" data-theme="paper" aria-label="Our principles">
  <svg class="rope" aria-hidden="true" data-rope><path/></svg>
  {rules}
</section>

<section class="section club-safety" data-theme="navy" aria-labelledby="safety-title">
  {rowhead("02", "Safety", "On every trip")}
  <h2 id="safety-title" class="h-lg" data-lines>Safety<br><em>first.</em></h2>
  <ol class="safety">
    <li data-reveal><span class="tnum">01</span><p><b>Certified guides</b> on all glacier and alpine trips. Club trip leaders are trained in first aid and navigation.</p></li>
    <li data-reveal><span class="tnum">02</span><p><b>A plan for every trip</b>, with the route, turnaround time and equipment list, shared a week before departure.</p></li>
    <li data-reveal><span class="tnum">03</span><p><b>Small groups.</b> At most six people per rope team, and at least two leaders on every multi-day trip.</p></li>
    <li data-reveal><span class="tnum">04</span><p><b>Weather decides.</b> Trips are moved or shortened whenever the conditions require it.</p></li>
  </ol>
</section>

<section class="section club-board" data-theme="paper" aria-labelledby="board-title">
  {rowhead("03", "The board", "Season 2026–27")}
  <h2 id="board-title" class="h-lg" data-lines>The board.</h2>
  <ul class="board">
    <li data-reveal><p class="label">Chair</p><p class="board-name">To be announced</p></li>
    <li data-reveal><p class="label">Treasurer</p><p class="board-name">To be announced</p></li>
    <li data-reveal><p class="label">Safety officer</p><p class="board-name">To be announced</p></li>
    <li data-reveal><p class="label">Trip leaders</p><p class="board-name">To be announced</p></li>
  </ul>
  <p class="small">The board is elected by the members every spring. You can contact it through the Join page.</p>
</section>

<section class="section club-history" data-theme="paper" aria-labelledby="hist-title">
  {rowhead("04", "History", "Since " + first["short"])}
  <h2 id="hist-title" class="h-lg" data-lines>Our trips so far.</h2>
  <ol class="hist">{hist}</ol>
  <a class="link home-more" href="{u(d, "archive/")}">All past trips →</a>
</section>
{join_band(d)}
</main>""" + footer(d))


# ------------------------------------------------------------------ join
FAQ = [
    ("I have never hiked. Can I join?", "Yes. Most trips require no experience, and those that do say so on the trip page. A day hike is a good place to start."),
    ("Do I need my own equipment?", "You need boots and a waterproof jacket. Technical equipment such as harnesses, crampons, ice axes and helmets can be borrowed from the club."),
    ("How are places on trips allocated?", "Members register when registration for a trip opens. If a trip is full there is a waiting list, and members who have not joined a multi-day trip before get priority."),
    ("What does it cost?", "Membership follows SASSE’s club fees. Trips are priced at cost (travel, accommodation, guides and food), and the price is published before registration opens."),
    ("Is the club only for Bachelor students?", "No. Bachelor, Master, PhD and exchange students with a SASSE membership are all welcome."),
    ("What happens if the weather is bad?", "The plan changes. Trips are moved or shortened when the conditions require it, and you will be told as early as possible."),
]


def join():
    d = 1
    return (head(d, "Join — Hiking Club", "How to join Hiking Club at SASSE: who can join, what it costs, how trips work, and the membership form.", "join", ())
            + header(d, "join/") + '<main id="main">'
            + page_head(d, "05", "Join", "Join the<br><em>club.</em>", "Membership is open to all students at the Stockholm School of Economics who are members of SASSE. No experience is needed.", "abisko")
            + f"""<section class="section join-facts" data-theme="paper" aria-label="Membership">
  {rowhead("01", "Membership", "Season 2026–27")}
  <div class="jf">
    <div data-reveal><p class="label">Who can join</p><p>All SSE students with a SASSE membership: Bachelor, Master, PhD and exchange students.</p></div>
    <div data-reveal><p class="label">Membership includes</p><p>Early access to trip registration, club equipment on loan, and a say in future trips.</p></div>
    <div data-reveal><p class="label">Experience</p><p>None is needed for day hikes. Each trip page states the level required, and we are happy to advise.</p></div>
    <div data-reveal><p class="label">Costs</p><p>The SASSE club membership fee, and trips at cost. Prices are published before registration opens.</p></div>
  </div>
</section>

""" + photos(d, "—", "What it looks like", "Autumn and winter", [
        ("club-pine-trail", "tall", "Members on a trail through sunlit pines.", None),
        ("winter-fells", "wide", "Snow-capped fells over a forest, under a clear winter sky.", None),
        ("forest-lake-frame", "tall", "A forest lake framed by trees.", None),
    ]) + f"""

<section class="section join-how" data-theme="pine" aria-labelledby="how-title">
  {rowhead("02", "How trips work", "Four steps")}
  <h2 id="how-title" class="h-lg" data-lines>How a trip<br><em>works.</em></h2>
  <ol class="how">
    <li data-reveal><span class="tnum">01</span><h3>Registration opens</h3><p>Each trip is announced with dates, level, price and number of places. Members hear first.</p></li>
    <li data-reveal><span class="tnum">02</span><h3>You register</h3><p>Places are confirmed within a week. If a trip is full, there is a waiting list.</p></li>
    <li data-reveal><span class="tnum">03</span><h3>The briefing</h3><p>A week before departure we go through the route, the equipment and the safety plan.</p></li>
    <li data-reveal><span class="tnum">04</span><h3>The trip</h3><p>Small groups, experienced leaders, and certified guides where the terrain requires them.</p></li>
  </ol>
</section>

<section class="section join-faq" data-theme="paper" aria-labelledby="faq-title">
  {rowhead("03", "Questions", f"{len(FAQ)} answers")}
  <h2 id="faq-title" class="h-lg" data-lines>Frequently asked<br><em>questions.</em></h2>
  <div class="faq">{"".join(f'<details class="faq-item"><summary><span>{esc(q)}</span><span class="log-plus" aria-hidden="true"></span></summary><p>{esc(a)}</p></details>' for q, a in FAQ)}</div>
</section>

<section class="section join" data-theme="pine" aria-labelledby="form-title">
  {rowhead("04", "The form", "We reply within a week")}
  <h2 id="form-title" class="display display-join" data-lines>Become<br><em>a member.</em></h2>
  <div class="join-grid">
    <ol class="steps">
      <li class="step" data-reveal><span class="tnum">01</span><p>Be a member of SASSE. <a class="link" href="https://www.sasse.se" rel="noopener">sasse.se</a></p></li>
      <li class="step" data-reveal><span class="tnum">02</span><p>Send the form. We reply within a week.</p></li>
      <li class="step" data-reveal><span class="tnum">03</span><p>Register for trips as each dossier opens.</p></li>
    </ol>
    <!-- The club's inbox. Replace with the board's real address or a form endpoint before launch. -->
    <form class="join-form" data-mailto="hikingclub@sasse.se" data-reveal>
      <label><span>Name</span><input name="name" autocomplete="name" required></label>
      <label><span>SSE email</span><input name="email" type="email" autocomplete="email" required placeholder="12345@student.hhs.se"></label>
      <label><span>Programme</span><select name="programme" required><option value="">Choose</option><option>Bachelor</option><option>Master</option><option>Exchange</option><option>PhD</option></select></label>
      <label><span>Experience</span><select name="experience" required><option value="">Choose</option><option>New to it</option><option>Some hiking</option><option>Climbing or alpine</option></select></label>
      <label class="join-check"><input type="checkbox" name="trip" value="Expedition 004 — Abisko"><span>Also register me for Expedition 004, Abisko</span></label>
      <button class="btn btn-snow" type="submit">Become a member<span class="btn-arrow" aria-hidden="true">→</span></button>
      <p class="join-status small" role="status"></p>
    </form>
  </div>
</section>
</main>""" + footer(d))


def write(rel, text):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    print("page", rel, len(text) // 1024, "KB")


if __name__ == "__main__":
    write("index.html", home())
    write("expeditions/index.html", expeditions())
    for e in EXP:
        write(f"expeditions/{e['slug']}/index.html", expedition(e))
    write("archive/index.html", archive())
    write("activities/index.html", activities())
    write("the-club/index.html", club())
    write("join/index.html", join())
