"""Download public Cinemeta/metahub artwork and convert it to formats the .fig takes."""
import io, json, sys, urllib.request
from PIL import Image
out = sys.argv[1]
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "mockup-assets/1.0"}), timeout=30).read()
def js(u): return json.loads(get(u))
C = "https://v3-cinemeta.strem.io"
FEATURE = [("movie","tt15239678"),("series","tt11280740"),("series","tt3581920"),("movie","tt9362722")]
meta = {"titles": {}, "movies": [], "series": []}
def legible(im):
    """A near-black wordmark disappears on the dark canvas: draw it white."""
    px = [p for p in im.getdata() if p[3] > 128]
    if px and sum(0.2126*r + 0.7152*g + 0.0722*b for r, g, b, _ in px) / len(px) < 60:
        white = Image.new("RGBA", im.size, (255, 255, 255, 0)); white.putalpha(im.getchannel("A")); return white
    return im
def save(url, name, size, fmt):
    try:
        im = Image.open(io.BytesIO(get(url)))
        im = im.convert("RGBA" if fmt == "PNG" else "RGB")
        im.thumbnail(size)
        if name.endswith("-logo.png"):
            im = legible(im)
        im.save(f"{out}/{name}", fmt, **({"quality": 82} if fmt == "JPEG" else {}))
        return {"file": name, "w": im.width, "h": im.height}
    except Exception as e:
        print("skip", name, e); return None
def title(kind, i):
    if i in meta["titles"]: return meta["titles"][i]
    m = js(f"{C}/meta/{kind}/{i}.json")["meta"]
    t = {k: m.get(k) for k in ("name","description","releaseInfo","runtime","imdbRating","genres","videos")}
    t.update(id=i, type=kind)
    mh = "https://images.metahub.space"
    t["poster"] = save(f"{mh}/poster/medium/{i}/img", f"{i}-poster.jpg", (360,540), "JPEG")
    t["background"] = save(f"{mh}/background/medium/{i}/img", f"{i}-bg.jpg", (1920,1080), "JPEG")
    t["logo"] = save(f"{mh}/logo/medium/{i}/img", f"{i}-logo.png", (800,310), "PNG")
    meta["titles"][i] = t; return t
for kind, i in FEATURE: title(kind, i)
# The rows the mockup draws, pinned to the titles it was designed with (Cinemeta's
# top lists of 2026-11-27): build.js names some of them by index and by id.
ROWS = {"movies": ["tt6611324", "tt33764258", "tt45368240", "tt14413964", "tt27165187", "tt1392170", "tt10545296", "tt7526136", "tt37287335", "tt35538033", "tt34206385", "tt1951264"],
        "series": ["tt8014982", "tt31510819", "tt7631058", "tt33043892", "tt27995113", "tt26598805", "tt11041332", "tt31842126", "tt12324366", "tt23112594", "tt9813792", "tt37972251"]}
for key, kind in (("movies","movie"),("series","series")):
    for i in ROWS[key]:
        try: t = title(kind, i)
        except Exception as e: print("skip", i, e); continue
        meta[key].append(t["id"])
s = meta["titles"]["tt11280740"]
eps = [v for v in s["videos"] if v.get("season") == 2][:7]
for v in eps:
    v["still"] = save(v.get("thumbnail"), f"ep-{v['season']}-{v['episode']}.jpg", (640,360), "JPEG")
s["episodes"] = eps
for t in meta["titles"].values(): t.pop("videos", None)
json.dump(meta, open(f"{out}/meta.json","w"), indent=1)
print(len(meta["titles"]), "titles", len(eps), "episodes")
for k in ("movies","series"): print(k, [meta["titles"][i]["name"] for i in meta[k]])
for _, i in FEATURE:
    t = meta["titles"][i]; print(i, t["name"], t["releaseInfo"], t["runtime"], t["imdbRating"], t["genres"], bool(t["logo"]), bool(t["background"]))
print([(v.get("name"), v.get("released","")[:10], bool(v["still"])) for v in eps])
