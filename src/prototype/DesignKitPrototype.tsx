/**
 * PROTOTYPE — Ticket #50: Design tokens and the component kit (desktop + phone)
 *
 * Three variants of the design tokens and component kit (desktop + phone),
 * switchable via `?variant=A|B|C` and the floating bottom bar.
 *
 * Throwaway artifact per `prototype/UI.md`.
 */

import { useEffect, useState } from "react";
import "./design-kit.css";

export type VariantKey = "A" | "B" | "C";

interface VariantMeta {
  key: VariantKey;
  name: string;
  tagline: string;
  accentHex: string;
  accentName: string;
  canvasHex: string;
  stageHex: string;
  raisedHex: string;
  inkHex: string;
  displayFont: string;
  uiFont: string;
  railShape: string;
  heroShape: string;
  cardShape: string;
  osdShape: string;
  focusRecipe: string;
}

const VARIANTS: Record<VariantKey, VariantMeta> = {
  A: {
    key: "A",
    name: "Projector Room",
    tagline: "Warm 3200K tungsten amber, editorial serif display + grotesque UI, compact 76px icon+label dock rail, borderless poster tiles, detached cinema OSD.",
    accentHex: "#F5A623",
    accentName: "Projector Amber",
    canvasHex: "#08080A",
    stageHex: "#101014",
    raisedHex: "#17171D",
    inkHex: "#F3F1EC",
    displayFont: "Instrument Serif (display) + Plus Jakarta Sans (UI & tabular figures)",
    uiFont: "Plus Jakarta Sans",
    railShape: "76px fixed icon + micro-label dock (zero horizontal layout shift)",
    heroShape: "Full-bleed cinema stage with bottom-left vignette + logo/serif title",
    cardShape: "Borderless 2:3 poster tile (6px radius) with metadata below the art",
    osdShape: "Floating centered cinema capsule (max 64rem) + upward popover drawer",
    focusRecipe: "2px dark gap + 3px solid #F5A623 ring + 30px warm amber halo + -3px lift",
  },
  B: {
    key: "B",
    name: "Reference Monitor",
    tagline: "Broadcast true-black, mastering cyan accent, unified Space Grotesk with tabular timecodes, 204px full-label spine rail, framed cards, edge-to-edge studio OSD deck.",
    accentHex: "#38BDF8",
    accentName: "Mastering Cyan",
    canvasHex: "#050608",
    stageHex: "#0B0D12",
    raisedHex: "#12161F",
    inkHex: "#F5F7FA",
    displayFont: "Space Grotesk across all ranks (-0.03em display tracking, tabular figures)",
    uiFont: "Space Grotesk",
    railShape: "204px architectural left spine with icon + full horizontal label always visible",
    heroShape: "Split asymmetric frame: 44% structured typography left, 56% 16:9 backdrop right",
    cardShape: "Sharp 3px-radius framed card (1px #1F2633 border) with enclosed footer",
    osdShape: "Full-width edge-to-edge bottom broadcast deck + segmented drawers",
    focusRecipe: "2px pure white inner bezel + 3px #38BDF8 outer ring + solid cyan button fill inversion",
  },
  C: {
    key: "C",
    name: "Velvet Curtains",
    tagline: "Deep obsidian canvas, smoked translucent glass, signal crimson accent, bold humanist display, inset floating icon rail, poster-wall tiles, split top/bottom glass OSD.",
    accentHex: "#FF4D4D",
    accentName: "Signal Crimson",
    canvasHex: "#09080C",
    stageHex: "#121018",
    raisedHex: "#1A1723",
    inkHex: "#FAF8F5",
    displayFont: "Syne (700 display) + Plus Jakarta Sans (UI & tabular figures)",
    uiFont: "Plus Jakarta Sans",
    railShape: "Floating inset smoked-glass dock (18px radius) with stacked icon + label",
    heroShape: "Inset rounded billboard card (18px radius) with smoked-glass copy scrim",
    cardShape: "12px-radius poster card on smoked stage",
    osdShape: "Split top Now-Playing header + bottom smoked-glass capsule",
    focusRecipe: "3px warm ivory core ring + 3px #FF4D4D outer crimson halo + -4px scale lift",
  },
};

const HERO_SLIDES = [
  {
    id: "tt0133093",
    name: "The Matrix",
    year: "1999",
    rating: "8.7",
    runtime: "136 min",
    genres: ["Action", "Sci-Fi"],
    catalog: "Featured · Cinemeta Top Movies",
    background: "https://images.metahub.space/background/medium/tt0133093/img",
    logo: "https://images.metahub.space/logo/medium/tt0133093/img",
    poster: "https://images.metahub.space/poster/small/tt0133093/img",
    description:
      "A computer hacker learns from mysterious rebels about the true nature of his reality and his role in the war against its controllers.",
  },
  {
    id: "tt0903747",
    name: "Breaking Bad",
    year: "2008–2013",
    rating: "9.5",
    runtime: "49 min",
    genres: ["Crime", "Drama", "Thriller"],
    catalog: "Featured · Cinemeta Top Movies",
    background: "https://images.metahub.space/background/medium/tt0903747/img",
    logo: "https://images.metahub.space/logo/medium/tt0903747/img",
    poster: "https://images.metahub.space/poster/small/tt0903747/img",
    description:
      "A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine with a former student to secure his family's future.",
  },
  {
    id: "tt22084616",
    name: "Spider-Man: Brand New Day",
    year: "2026",
    rating: "8.0",
    runtime: "145 min",
    genres: ["Action", "Adventure"],
    catalog: "Featured · Cinemeta Top Movies",
    background: "https://images.metahub.space/background/medium/tt22084616/img",
    logo: "https://images.metahub.space/logo/medium/tt22084616/img",
    poster: "https://images.metahub.space/poster/small/tt22084616/img",
    description:
      "A forgotten Peter Parker lives alone as a full-time Spider-Man until mounting pressure triggers a dangerous change and a powerful new enemy emerges.",
  },
  {
    id: "tt15047880",
    name: "Disclosure Day",
    year: "2026",
    rating: "6.4",
    runtime: "146 min",
    genres: ["Action", "Mystery", "Sci-Fi"],
    catalog: "Featured · Cinemeta Top Movies",
    background: "https://images.metahub.space/background/medium/tt15047880/img",
    logo: "https://images.metahub.space/logo/medium/tt15047880/img",
    poster: "https://images.metahub.space/poster/small/tt15047880/img",
    description:
      "If you found out we weren't alone, if someone showed you, proved it to you, would that frighten you?",
  },
];

const CONTINUE_WATCHING = [
  {
    key: "series/tt0903747:1:1",
    title: "Breaking Bad — S1E1",
    subtitle: "Pilot · 31:40 left",
    progress: 0.35,
    backdrop: "https://images.metahub.space/background/medium/tt0903747/img",
    unplayable: false,
  },
  {
    key: "movie/tt0133093",
    title: "The Matrix",
    subtitle: "48:15 left",
    progress: 0.64,
    backdrop: "https://images.metahub.space/background/medium/tt0133093/img",
    unplayable: false,
  },
  {
    key: "movie/tt34206385",
    title: "Primetime",
    subtitle: "Unplayable — Addon com.stremboxd.popular is gone",
    progress: 0.22,
    backdrop: "https://images.metahub.space/background/medium/tt34206385/img",
    unplayable: true,
  },
];

const CATALOG_POPULAR = [
  {
    id: "tt22084616",
    name: "Spider-Man: Brand New Day",
    year: "2026",
    rating: "8.0",
    poster: "https://images.metahub.space/poster/small/tt22084616/img",
    unmapped: false,
  },
  {
    id: "tt37287335",
    name: "Obsession",
    year: "2026",
    rating: "7.8",
    poster: "https://images.metahub.space/poster/small/tt37287335/img",
    unmapped: false,
  },
  {
    id: "tt26657236",
    name: "Backrooms",
    year: "2026",
    rating: "6.7",
    poster: "https://images.metahub.space/poster/small/tt26657236/img",
    unmapped: false,
  },
  {
    id: "tt36983905",
    name: "The Uprising",
    year: "2026",
    rating: "7.4",
    poster: "https://images.metahub.space/poster/small/tt36983905/img",
    unmapped: false,
  },
  {
    id: "tt0903747",
    name: "Breaking Bad: El Camino Cut",
    year: "2019",
    rating: "Unmapped",
    poster: "https://images.metahub.space/poster/small/tt0903747/img",
    unmapped: true,
  },
];

const RAIL_ITEMS: Array<{ id: string; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-9.5z" },
  { id: "discover", label: "Discover", icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.8 6.2-2.4 5.2-5.2 2.4 2.4-5.2 5.2-2.4z" },
  { id: "search", label: "Search", icon: "M11 4a7 7 0 1 0 4.4 12.4l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4z" },
  { id: "library", label: "Library", icon: "M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1z" },
  { id: "addons", label: "Addons", icon: "M12 2l4 4-4 4-4-4 4-4zm6 6l4 4-4 4-4-4 4-4zM6 8l4 4-4 4-4-4 4-4zm6 6l4 4-4 4-4-4 4-4z" },
  { id: "settings", label: "Settings", icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-9 4 2.1-.8a7.2 7.2 0 0 1 .7-1.7L4.9 7.4 7.4 4.9l2.1.9c.5-.3 1.1-.5 1.7-.7L12 3l.8 2.1c.6.2 1.2.4 1.7.7l2.1-.9 2.5 2.5-.9 2.1c.3.5.5 1.1.7 1.7L21 12l-2.1.8c-.2.6-.4 1.2-.7 1.7l.9 2.1-2.5 2.5-2.1-.9c-.5.3-1.1.5-1.7.7L12 21l-.8-2.1a7.2 7.2 0 0 1-1.7-.7l-2.1.9-2.5-2.5.9-2.1a7.2 7.2 0 0 1-.7-1.7L3 12z" },
];

function readVariantFromUrl(): VariantKey {
  const raw = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  if (raw === "A" || raw === "B" || raw === "C") {
    return raw;
  }
  return "C";
}

export function DesignKitPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariantFromUrl);
  const [activeNav, setActiveNav] = useState("home");
  const [slideIdx, setSlideIdx] = useState(0);
  const [heroFocused, setHeroFocused] = useState(false);
  const [simFocusId, setSimFocusId] = useState<string>("card-tt22084616");
  const [osdOpen, setOsdOpen] = useState(true);
  const [osdMenuTab, setOsdMenuTab] = useState<"none" | "subtitles" | "audio" | "chapters" | "picture">("subtitles");
  const [selectedAudio, setSelectedAudio] = useState(1);
  const [selectedSub, setSelectedSub] = useState<number | null>(3);
  const [selectedSpeed, setSelectedSpeed] = useState(1);
  const [selectedAspect, setSelectedAspect] = useState("Source");
  const [selectedCrop, setSelectedCrop] = useState("Full frame");
  const [subDelay, setSubDelay] = useState(0);
  const [volume, setVolume] = useState(100);
  const [scrubberSec, setScrubberSec] = useState(5295);
  const [showDialog, setShowDialog] = useState(false);

  const changeVariant = (next: VariantKey) => {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState({}, "", url.toString());
  };

  // Keyboard ← / → cycles variants per prototype/UI.md when not inside an input
  useEffect(() => {
    const order: VariantKey[] = ["A", "B", "C"];
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const idx = order.indexOf(variant);
        const nextIdx =
          event.key === "ArrowRight"
            ? (idx + 1) % order.length
            : (idx - 1 + order.length) % order.length;
        const nextVariant = order[nextIdx] ?? "A";
        changeVariant(nextVariant);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [variant]);

  // Hero auto-rotates while unfocused and holds once focused (#52)
  useEffect(() => {
    if (heroFocused) {
      return;
    }
    const timer = window.setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [heroFocused]);

  const meta = VARIANTS[variant];
  const slide = HERO_SLIDES[slideIdx] ?? HERO_SLIDES[0]!;

  return (
    <div className="proto-root" data-variant={variant} data-testid="design-kit-prototype">
      {/* Top Workbench Header */}
      <header className="proto-workbench-bar">
        <div className="proto-workbench-title">
          <span className="proto-pill-tag">PROTOTYPE · #50</span>
          <strong>
            Variant {meta.key} — {meta.name}
          </strong>
          <span style={{ color: "var(--ink-secondary)", fontSize: "var(--text-caption)" }}>
            {meta.tagline}
          </span>
        </div>

        <div className="proto-workbench-tabs" role="group" aria-label="Spotlight focus target">
          <span style={{ fontSize: "var(--text-micro)", color: "var(--ink-secondary)", alignSelf: "center" }}>
            D-pad focus spotlight:
          </span>
          {[
            { id: "hero-stage", label: "Hero Slide" },
            { id: "rail-home", label: "Nav Rail" },
            { id: "cw-series/tt0903747:1:1", label: "Continue Watching" },
            { id: "card-tt22084616", label: "Poster Card" },
            { id: "osd-play", label: "OSD Play" },
          ].map((target) => (
            <button
              key={target.id}
              type="button"
              className="proto-tab"
              aria-pressed={simFocusId === target.id}
              onClick={() => setSimFocusId(target.id)}
            >
              {target.label}
            </button>
          ))}
        </div>
      </header>

      {/* SECTION 1: LIVE TEN-FOOT DESKTOP SHELL (RAIL + HERO + CONTINUE WATCHING + ROWS) */}
      <section className="tenfoot-stage-frame" aria-label="Desktop ten-foot shell">
        <div className="tenfoot-shell">
          {/* Persistent Left Rail (#52: Home · Discover · Search · Library · Addons · Settings) */}
          <nav className="nav-rail" aria-label="Primary navigation">
            <div className="rail-brand" title="streamingapp">
              {variant === "B" ? "STREAMINGAPP" : "S"}
            </div>
            {RAIL_ITEMS.map((item) => {
              const focusKey = `rail-${item.id}`;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="rail-item"
                  data-focusable
                  data-sim-focus={simFocusId === focusKey}
                  aria-current={activeNav === item.id ? "page" : undefined}
                  onClick={() => {
                    setActiveNav(item.id);
                    setSimFocusId(focusKey);
                  }}
                >
                  <svg className="rail-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d={item.icon} />
                  </svg>
                  <span className="rail-label">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Main scrollable Home canvas */}
          <div className="tenfoot-main">
            {/* Four-slide Featured catalog Hero (#52 + #59) */}
            <div
              role="button"
              tabIndex={0}
              className="hero-stage"
              data-focusable
              data-sim-focus={simFocusId === "hero-stage"}
              onFocus={() => setHeroFocused(true)}
              onBlur={() => setHeroFocused(false)}
              onClick={() => setSimFocusId("hero-stage")}
              aria-label={`Featured Title: ${slide.name}. Press to open Title.`}
            >
              {variant === "B" ? (
                <div className="hero-backdrop-wrap">
                  <img className="hero-backdrop" src={slide.background} alt="" />
                  <div className="hero-scrim" />
                </div>
              ) : (
                <>
                  <img className="hero-backdrop" src={slide.background} alt="" />
                  <div className="hero-scrim" />
                </>
              )}

              <div className="hero-copy">
                <div className="hero-kicker tabular">
                  <span className="hero-kicker-source">{slide.catalog}</span>
                  <span>{slide.year}</span>
                  <span>★ {slide.rating}</span>
                  <span>{slide.runtime}</span>
                  <span>{slide.genres.join(", ")}</span>
                </div>

                <h1 className="hero-headline">{slide.name}</h1>
                <p className="hero-description">{slide.description}</p>

                <div className="hero-footer">
                  <span className="kit-btn kit-btn-primary">Open Title</span>
                  <div className="hero-dots" role="tablist" aria-label="Featured slides">
                    {HERO_SLIDES.map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        className="hero-dot"
                        aria-label={`Slide ${idx + 1}: ${s.name}`}
                        aria-current={idx === slideIdx ? "true" : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSlideIdx(idx);
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: "var(--text-micro)", color: "var(--ink-secondary)" }}>
                    {heroFocused ? "Focused · rotation held" : "Auto-rotating · 4 slides"}
                  </span>
                </div>
              </div>
            </div>

            {/* Row 1: Continue watching (#52) */}
            <section className="catalog-section" aria-label="Continue watching">
              <div className="row-header">
                <div className="row-title-group">
                  <h2 className="row-title">Continue watching</h2>
                  <span className="row-addon-tag">Host Watch progress</span>
                </div>
              </div>
              <ul className="cw-strip">
                {CONTINUE_WATCHING.map((entry) => {
                  const focusKey = `cw-${entry.key}`;
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        className="cw-card"
                        data-focusable
                        data-sim-focus={simFocusId === focusKey}
                        data-unplayable={entry.unplayable ? "true" : undefined}
                        onClick={() => setSimFocusId(focusKey)}
                      >
                        <div className="cw-art-wrap">
                          <img className="cw-art" src={entry.backdrop} alt="" />
                          <span className="cw-progress-track">
                            <span
                              className="cw-progress-fill"
                              style={{ width: `${Math.round(entry.progress * 100)}%` }}
                            />
                          </span>
                        </div>
                        <div className="cw-body">
                          <span className="cw-name">{entry.title}</span>
                          <span className={entry.unplayable ? "cw-meta-warn" : "cw-meta tabular"}>
                            {entry.subtitle}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Row 2: Catalog Row with Poster Cards + More paging */}
            <section className="catalog-section" aria-label="Popular — Cinemeta">
              <div className="row-header">
                <div className="row-title-group">
                  <h2 className="row-title">Popular Movies</h2>
                  <span className="row-addon-tag">com.linvo.cinemeta</span>
                </div>
                <button
                  type="button"
                  className="kit-btn kit-btn-ghost"
                  data-focusable
                  data-sim-focus={simFocusId === "row-more"}
                  onClick={() => setSimFocusId("row-more")}
                >
                  More
                </button>
              </div>
              <ul className="poster-strip">
                {CATALOG_POPULAR.map((item) => {
                  const focusKey = `card-${item.id}`;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="poster-card"
                        data-focusable
                        data-sim-focus={simFocusId === focusKey}
                        onClick={() => setSimFocusId(focusKey)}
                      >
                        <div className="poster-art-wrap">
                          <img className="poster-art" src={item.poster} alt="" loading="lazy" />
                          {item.unmapped ? (
                            <span className="poster-badge-unmapped">Unmapped</span>
                          ) : null}
                        </div>
                        <div className="poster-info">
                          <span className="poster-name">{item.name}</span>
                          <span className="poster-sub tabular">
                            {item.year} {item.unmapped ? "· Addon id only" : `· ★ ${item.rating}`}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Row 3: Inline Failed Catalog Row (#52 rule: fails in place, leaves rest of Home alone) */}
            <section className="catalog-section" aria-label="Letterboxd Popular">
              <div className="row-header">
                <div className="row-title-group">
                  <h2 className="row-title">Letterboxd Popular</h2>
                  <span className="row-addon-tag">com.stremboxd.popular</span>
                </div>
              </div>
              <div className="row-failure" role="status">
                <span>
                  The Host could not fetch that Addon: connection timed out after 10 s. Other Catalogs on Home stay interactive.
                </span>
                <button type="button" className="kit-btn" data-focusable>
                  Retry catalog
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>

      {/* SECTION 2: UOSC PLAYER OSD + NETFLIX 3-SURFACE CAST REMOTE + TOKENS */}
      <div className="kit-stack">
        {/* Full-screen Player OSD Component (uosc-inspired edge-to-edge timeline + icon strip) */}
        <section className="kit-panel" aria-label="Full-screen player OSD">
          <div className="row-header">
            <div>
              <h3>Full-screen Player OSD (Desktop · uosc-style edge-to-edge timeline + icon deck)</h3>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--ink-secondary)" }}>
                Top-left Stream pills, right-edge volume pillar, floating icon controls, and flush edge-to-edge timeline with diamond chapter markers and inline timestamps.
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="kit-btn kit-btn-choice"
                aria-pressed={osdMenuTab !== "none"}
                onClick={() => setOsdMenuTab((t) => (t === "none" ? "subtitles" : "none"))}
              >
                {osdMenuTab !== "none" ? "Close Menu Popover" : "Open Menu Popover"}
              </button>
              <button
                type="button"
                className="kit-btn kit-btn-choice"
                aria-pressed={osdOpen}
                onClick={() => setOsdOpen((v) => !v)}
              >
                {osdOpen ? "OSD Visible" : "OSD Hidden (Film Hole)"}
              </button>
            </div>
          </div>

          <div className="osd-stage">
            <img
              className="osd-film-frame"
              src="https://images.metahub.space/background/medium/tt0133093/img"
              alt="Simulated mpv swapchain frame"
            />
            {osdOpen ? <div className="osd-vignette" /> : null}

            {osdOpen ? (
              <>
                {/* Top-left uosc pill badges + top-right window/back icon */}
                <div className="uosc-top-bar">
                  <div className="uosc-top-meta">
                    <div className="uosc-top-row">
                      <span className="uosc-badge-index tabular">4K HDR</span>
                      <span className="uosc-badge-title">The Matrix (1999)</span>
                    </div>
                    <div className="uosc-badge-sub tabular">
                      └ torrentio.strem.fun · HEVC TrueHD 7.1 · 24.8 Mbps · d3d11va
                    </div>
                  </div>

                  <button
                    type="button"
                    className="uosc-icon-btn"
                    data-focusable
                    title="Stop playback and return to Title (Back)"
                    aria-label="Stop playback"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Middle layer: spacer + vertical volume pillar on right */}
                <div className="uosc-middle-layer">
                  <div />

                  {/* Right-edge vertical volume pillar (from uosc reference) */}
                  <div className="uosc-volume-pillar">
                    <div
                      className="uosc-volume-track"
                      onClick={() => setVolume((v) => (v === 100 ? 70 : 100))}
                      title="Click to toggle volume preview"
                    >
                      <div className="uosc-volume-fill tabular" style={{ height: `${volume}%` }}>
                        {volume}
                      </div>
                    </div>
                    <button type="button" className="uosc-icon-btn" data-focusable aria-label="Mute / Volume">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11 5L6 9H2v6h4l5 4V5zm4.5 7c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM13 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Bottom uosc icon strip (Left: Menu/Subs/Audio · Center: PrevEp/-10s/Play/+10s/NextEp · Right: Speed/Chapters/Stop) + flush edge-to-edge timeline bar */}
                <div className="uosc-bottom-stack">
                  <div className="uosc-control-strip">
                    {/* Left icon cluster: per-icon popovers for Menu/Picture, Subtitles, Audio */}
                    <div className="uosc-icon-cluster-left">
                      {/* Picture / Aspect / Crop / Statistics icon + popover */}
                      <div className="uosc-icon-anchor">
                        {osdMenuTab === "picture" ? (
                          <div className="uosc-icon-popover" role="dialog" aria-label="Picture and statistics">
                            <div className="uosc-popover-heading">Picture — Aspect & Crop</div>
                            {["Source", "16:9", "21:9"].map((asp) => (
                              <button
                                key={asp}
                                type="button"
                                className="uosc-menu-item"
                                data-focusable
                                aria-pressed={selectedAspect === asp}
                                onClick={() => setSelectedAspect(asp)}
                              >
                                <span>{selectedAspect === asp ? `✓ Aspect: ${asp}` : `Aspect: ${asp}`}</span>
                              </button>
                            ))}
                            {["Full frame", "Crop 21:9"].map((cr) => (
                              <button
                                key={cr}
                                type="button"
                                className="uosc-menu-item"
                                data-focusable
                                aria-pressed={selectedCrop === cr}
                                onClick={() => setSelectedCrop(cr)}
                              >
                                <span>{selectedCrop === cr ? `✓ ${cr}` : cr}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="uosc-icon-btn"
                          data-focusable
                          aria-pressed={osdMenuTab === "picture"}
                          onClick={() => setOsdMenuTab((t) => (t === "picture" ? "none" : "picture"))}
                          title="Picture (Aspect & Crop)"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M4 6h16M4 12h16M4 18h11" />
                          </svg>
                        </button>
                      </div>

                      {/* Subtitles icon + per-icon popover */}
                      <div className="uosc-icon-anchor">
                        {osdMenuTab === "subtitles" ? (
                          <div className="uosc-icon-popover" role="dialog" aria-label="Subtitles">
                            <div className="uosc-popover-heading">
                              Subtitles · Delay {subDelay >= 0 ? `+${subDelay.toFixed(1)}` : subDelay.toFixed(1)} s
                            </div>
                            {[
                              { id: null, label: "Off", tag: "" },
                              { id: 3, label: "Portuguese (pt-BR)", tag: "embedded · default" },
                              { id: 4, label: "English (SDH)", tag: "embedded" },
                            ].map((t) => (
                              <button
                                key={String(t.id)}
                                type="button"
                                className="uosc-menu-item"
                                data-focusable
                                aria-pressed={selectedSub === t.id}
                                onClick={() => setSelectedSub(t.id)}
                              >
                                <span>{selectedSub === t.id ? `✓ ${t.label}` : t.label}</span>
                                <span style={{ fontSize: "var(--text-micro)", color: "var(--ink-secondary)" }}>
                                  {t.tag}
                                </span>
                              </button>
                            ))}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "0.35rem 0.5rem 0.1rem",
                                borderTop: "1px solid var(--border-subtle)",
                                marginTop: "0.2rem",
                              }}
                            >
                              <button
                                type="button"
                                className="proto-tab tabular"
                                onClick={() => setSubDelay((d) => Math.round((d - 0.1) * 10) / 10)}
                              >
                                −0.1 s
                              </button>
                              <button
                                type="button"
                                className="proto-tab tabular"
                                onClick={() => setSubDelay((d) => Math.round((d + 0.1) * 10) / 10)}
                              >
                                +0.1 s
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="uosc-icon-btn"
                          data-focusable
                          aria-pressed={osdMenuTab === "subtitles"}
                          onClick={() => setOsdMenuTab((t) => (t === "subtitles" ? "none" : "subtitles"))}
                          title="Subtitles"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <path d="M7 15h4m4 0h2M7 11h2m4 0h4" />
                          </svg>
                        </button>
                      </div>

                      {/* Audio icon + per-icon popover */}
                      <div className="uosc-icon-anchor">
                        {osdMenuTab === "audio" ? (
                          <div className="uosc-icon-popover" role="dialog" aria-label="Audio tracks">
                            <div className="uosc-popover-heading">Audio Tracks</div>
                            {[
                              { id: 1, label: "English · TrueHD Atmos 7.1", tag: "default" },
                              { id: 2, label: "Portuguese · EAC3 5.1", tag: "embedded" },
                            ].map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                className="uosc-menu-item"
                                data-focusable
                                aria-pressed={selectedAudio === t.id}
                                onClick={() => setSelectedAudio(t.id)}
                              >
                                <span>{selectedAudio === t.id ? `✓ ${t.label}` : t.label}</span>
                                <span style={{ fontSize: "var(--text-micro)", color: "var(--ink-secondary)" }}>
                                  {t.tag}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="uosc-icon-btn"
                          data-focusable
                          aria-pressed={osdMenuTab === "audio"}
                          onClick={() => setOsdMenuTab((t) => (t === "audio" ? "none" : "audio"))}
                          title="Audio Tracks"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* CENTER TRANSPORT CLUSTER: Prev Episode · Rewind −10s · Centered Play/Pause · Forward +10s · Next Episode */}
                    <div className="uosc-icon-cluster-center">
                      <button
                        type="button"
                        className="uosc-icon-btn"
                        disabled
                        title="Previous episode (disabled for films or S1E1)"
                        aria-label="Previous episode"
                        style={{ opacity: 0.32, cursor: "not-allowed" }}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        className="uosc-icon-btn tabular"
                        data-focusable
                        onClick={() => setScrubberSec((s) => Math.max(0, s - 10))}
                        title="Rewind 10 seconds"
                        aria-label="Rewind 10 seconds"
                      >
                        ↺10
                      </button>

                      <button
                        type="button"
                        className="uosc-icon-btn"
                        data-focusable
                        data-sim-focus={simFocusId === "osd-play"}
                        aria-pressed="true"
                        onClick={() => setSimFocusId("osd-play")}
                        title="Play / Pause"
                        aria-label="Pause"
                        style={{ minWidth: "2.65rem", height: "2.45rem" }}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        className="uosc-icon-btn tabular"
                        data-focusable
                        onClick={() => setScrubberSec((s) => Math.min(8160, s + 10))}
                        title="Forward 10 seconds"
                        aria-label="Forward 10 seconds"
                      >
                        10↻
                      </button>

                      <button
                        type="button"
                        className="uosc-icon-btn"
                        data-focusable
                        title="Next episode"
                        aria-label="Next episode"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                        </svg>
                      </button>
                    </div>

                    {/* Right icon cluster: Speed & Chapters list popover (no prev/next chapter step buttons) */}
                    <div className="uosc-icon-cluster-right">
                      <button
                        type="button"
                        className="uosc-icon-btn tabular"
                        data-focusable
                        onClick={() => setSelectedSpeed((s) => (s === 1 ? 1.25 : s === 1.25 ? 1.5 : s === 1.5 ? 2 : 1))}
                        title="Playback speed"
                      >
                        {selectedSpeed}×
                      </button>

                      {/* Chapters icon + per-icon popover */}
                      <div className="uosc-icon-anchor">
                        {osdMenuTab === "chapters" ? (
                          <div className="uosc-icon-popover uosc-icon-popover-right" role="dialog" aria-label="Chapters">
                            <div className="uosc-popover-heading">Chapters</div>
                            {[
                              { time: "00:00", title: "1. Trinity in the Heart O' The City" },
                              { time: "19:40", title: "5. The Pill Choice" },
                              { time: "1:28:15", title: "14. Chateau Fight", active: true },
                              { time: "1:54:10", title: "19. Lobby Shootout" },
                            ].map((ch) => (
                              <button
                                key={ch.title}
                                type="button"
                                className="uosc-menu-item tabular"
                                data-focusable
                                aria-pressed={Boolean(ch.active)}
                              >
                                <span>{ch.title}</span>
                                <span style={{ color: "var(--ink-secondary)" }}>{ch.time}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="uosc-icon-btn"
                          data-focusable
                          aria-pressed={osdMenuTab === "chapters"}
                          onClick={() => setOsdMenuTab((t) => (t === "chapters" ? "none" : "chapters"))}
                          title="Chapters"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="4" y="4" width="16" height="16" rx="2" />
                            <path d="M8 9h8M8 12h8M8 15h5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Edge-to-edge flush timeline bar with hover-only diamond chapter markers and inline timestamps */}
                  <div
                    className="uosc-timeline tabular"
                    role="slider"
                    aria-label="Seek timeline"
                    aria-valuemin={0}
                    aria-valuemax={8160}
                    aria-valuenow={scrubberSec}
                    onClick={() => setScrubberSec((s) => (s === 5295 ? 3600 : 5295))}
                  >
                    <div
                      className="uosc-timeline-fill"
                      style={{ width: `${Math.round((scrubberSec / 8160) * 100)}%` }}
                    />
                    <div
                      className="uosc-timeline-playhead"
                      style={{ left: `${Math.round((scrubberSec / 8160) * 100)}%` }}
                    />

                    {/* Chapter diamond ticks along the top edge — chapter name appears ONLY on hover over the diamond */}
                    {[
                      { pct: 14, name: "Chapter 3 · Morpheus Calls", time: "19:02" },
                      { pct: 28, name: "Chapter 7 · The Real World", time: "38:04" },
                      { pct: 46, name: "Chapter 11 · The Oracle", time: "1:02:34" },
                      { pct: 65, name: "Chapter 14 · Chateau Fight", time: "1:28:15" },
                      { pct: 84, name: "Chapter 19 · Lobby Shootout", time: "1:54:10" },
                    ].map((ch) => (
                      <div key={ch.pct} className="uosc-chapter-marker" style={{ left: `${ch.pct}%` }}>
                        <span className="uosc-chapter-diamond" />
                        <div className="uosc-hover-callout">
                          <span className="uosc-hover-chapter">{ch.name}</span>
                          <span className="uosc-hover-time">{ch.time}</span>
                        </div>
                      </div>
                    ))}

                    <span className="uosc-time-left">1:28:15</span>
                    <span className="uosc-time-right">−0:47:45</span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </section>

        {/* Netflix 3-Surface Companion Cast Remote Triptych */}
        <section className="kit-panel" aria-label="Companion cast remote three surfaces">
          <div className="row-header">
            <div>
              <h3>Companion · Cast Remote (Netflix 3-Surface Architecture · 390px Phone)</h3>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--ink-secondary)" }}>
                1. Mobile Browse + Docked Cast Mini-Strip + Bottom Nav → 2. Full-Screen Cast Remote (Centered Poster, 3 Utility Icons, Crimson Scrubber, Big Transport) → 3. Translucent Audio & Subtitles Overlay Sheet
              </span>
            </div>
          </div>

          <div className="phone-triptych">
            {/* PHONE SURFACE 1: Browse + Docked Cast Strip + Bottom Nav */}
            <aside className="phone-bezel" aria-label="Phone Surface 1: Browsing with Cast Mini-Strip">
              <div className="cast-browse-hero">
                <img src="https://images.metahub.space/background/medium/tt0903747/img" alt="" />
                <div className="cast-browse-scrim" />
                <div className="cast-browse-hero-content">
                  <span style={{ fontSize: "var(--text-micro)", color: "var(--accent)", fontWeight: 700 }}>
                    FEATURED · CINEMETA TOP SERIES
                  </span>
                  <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.65rem", lineHeight: 1.05 }}>
                    Breaking Bad
                  </h4>
                  <span style={{ fontSize: "var(--text-micro)", color: "var(--ink-secondary)" }}>
                    2008–2013 · ★ 9.5 · Crime, Drama
                  </span>
                  <div className="cast-browse-actions">
                    <button type="button" className="kit-btn kit-btn-primary" style={{ padding: "0.45rem 1.2rem" }}>
                      ▶ Play on Host
                    </button>
                    <button type="button" className="kit-btn kit-btn-ghost" style={{ padding: "0.45rem 0.9rem" }}>
                      ⓘ Title Info
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ padding: "0.75rem 0.9rem" }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: "0.45rem" }}>
                  Popular Movies
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.45rem" }}>
                  {CATALOG_POPULAR.slice(0, 3).map((item) => (
                    <div key={item.id} className="poster-card">
                      <div className="poster-art-wrap">
                        <img className="poster-art" src={item.poster} alt="" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Docked Mini-Player Cast Strip right above bottom nav */}
              <div className="cast-ministrip" role="region" aria-label="Now playing mini-strip">
                <button type="button" className="cast-icon-btn tabular" title="Rewind 10s">
                  ↺10
                </button>
                <div className="cast-ministrip-center">
                  <span style={{ fontSize: "0.65rem", color: "var(--ink-secondary)", lineHeight: 1 }}>︿</span>
                  <strong style={{ fontSize: "0.84rem" }}>Breaking Bad</strong>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-secondary)" }}>S1:E1 - Pilot</span>
                </div>
                <button type="button" className="cast-icon-btn" title="Pause">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                  </svg>
                </button>
              </div>

              {/* Bottom Tab Bar */}
              <nav className="cast-bottom-nav" aria-label="Mobile navigation">
                {[
                  { label: "Home", active: true },
                  { label: "Discover", active: false },
                  { label: "Search", active: false },
                  { label: "Addons", active: false },
                  { label: "Settings", active: false },
                ].map((nav) => (
                  <button
                    key={nav.label}
                    type="button"
                    className="cast-bottom-nav-item"
                    aria-current={nav.active ? "page" : undefined}
                  >
                    <span>●</span>
                    <span>{nav.label}</span>
                  </button>
                ))}
              </nav>
            </aside>

            {/* PHONE SURFACE 2: Expanded Full-Screen Cast Remote */}
            <aside className="phone-bezel" aria-label="Phone Surface 2: Expanded Cast Remote">
              <div className="cast-remote-screen">
                <div className="cast-remote-header">
                  <span style={{ color: "var(--ink-secondary)", fontSize: "0.9rem" }}>﹀</span>
                  <strong style={{ fontSize: "0.98rem" }}>Breaking Bad</strong>
                  <span style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>S1:E1 - Pilot</span>
                </div>

                {/* Centered Poster */}
                <div className="cast-remote-poster-wrap">
                  <img
                    className="cast-remote-poster"
                    src="https://images.metahub.space/poster/small/tt0903747/img"
                    alt="Breaking Bad poster"
                  />
                </div>

                {/* 3 Utility Icons: Subtitles/Audio, Volume, Episodes (series only; disabled on films) */}
                <div className="cast-utility-row">
                  <button type="button" className="cast-icon-btn" title="Audio & Subtitles (opens Surface 3)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM6 10h4v2H6v-2zm10 6H6v-2h10v2zm2 0h-1v-2h1v2zm0-4h-6v-2h6v2z" />
                    </svg>
                  </button>
                  <button type="button" className="cast-icon-btn" title="Volume / Mute">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11 5L6 9H2v6h4l5 4V5zm4.5 7c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="cast-icon-btn"
                    title="Episodes list (active on series; disabled on movies)"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                    </svg>
                  </button>
                </div>

                {/* Full-width Scrubber with Crimson Circle Thumb */}
                <div className="cast-scrubber-section tabular">
                  <div className="cast-scrubber-times">
                    <span>17:20</span>
                    <span>49:00</span>
                  </div>
                  <div className="cast-scrubber-track">
                    <div className="cast-scrubber-fill" style={{ width: "35%" }} />
                    <div className="cast-scrubber-thumb" style={{ left: "35%" }} />
                  </div>
                </div>

                {/* Transport Row: Prev Ep (disabled on S1E1) · −10s · Centered Pause/Play · +10s · Next Ep + Stop */}
                <div className="cast-transport-row">
                  <button
                    type="button"
                    className="cast-icon-btn"
                    disabled
                    title="Previous episode (disabled on S1E1 or movie)"
                    aria-label="Previous episode"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="cast-icon-btn tabular"
                    style={{ fontSize: "0.88rem", fontWeight: 700 }}
                    title="Rewind 10 seconds"
                  >
                    ↺10
                  </button>

                  <button
                    type="button"
                    className="cast-icon-btn"
                    style={{ width: "3.5rem", height: "3.5rem", color: "var(--ink-primary)" }}
                    title="Pause"
                  >
                    <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="cast-icon-btn tabular"
                    style={{ fontSize: "0.88rem", fontWeight: 700 }}
                    title="Forward 10 seconds"
                  >
                    10↻
                  </button>

                  <button
                    type="button"
                    className="cast-icon-btn"
                    title="Next episode (disabled if last episode or movie)"
                    aria-label="Next episode"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                    </svg>
                  </button>

                  <button type="button" className="cast-icon-btn" title="Stop playback">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                  </button>
                </div>

                {/* Bottom Connected Host Footer */}
                <div className="cast-target-footer">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z" />
                  </svg>
                  <span>Living Room Host · Menoti’s Phone</span>
                </div>
              </div>
            </aside>

            {/* PHONE SURFACE 3: Translucent Audio & Subtitles Overlay Sheet */}
            <aside className="phone-bezel" aria-label="Phone Surface 3: Audio and Subtitles Sheet">
              <div className="cast-track-overlay">
                <div>
                  <div className="cast-track-section">
                    <h4>Audio</h4>
                    <ul className="cast-track-list">
                      {[
                        { id: 1, label: "English [Original] (TrueHD 7.1)" },
                        { id: 2, label: "Portuguese (EAC3 5.1)" },
                        { id: 3, label: "Spanish (Stereo)" },
                      ].map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            className="cast-track-row"
                            aria-pressed={selectedAudio === t.id}
                            onClick={() => setSelectedAudio(t.id)}
                          >
                            <span>{selectedAudio === t.id ? "✓" : ""}</span>
                            <span>{t.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="cast-track-section">
                    <h4>Subtitles</h4>
                    <ul className="cast-track-list">
                      {[
                        { id: null, label: "Off" },
                        { id: 3, label: "Portuguese (pt-BR · embedded)" },
                        { id: 4, label: "English (SDH)" },
                        { id: 5, label: "Spanish" },
                      ].map((t) => (
                        <li key={String(t.id)}>
                          <button
                            type="button"
                            className="cast-track-row"
                            aria-pressed={selectedSub === t.id}
                            onClick={() => setSelectedSub(t.id)}
                          >
                            <span>{selectedSub === t.id ? "✓" : ""}</span>
                            <span>{t.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="cast-sheet-actions">
                  <button type="button" className="kit-btn">
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="kit-btn"
                    style={{ background: "#faf8f5", color: "#09080c", borderColor: "transparent" }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* Buttons, Dialogs & Toasts */}
        <section className="kit-panel" aria-label="Buttons, dialogs and toasts">
          <h3>Buttons, Choice Chips, Refusal Toast & Dialog</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1rem" }}>
            <button type="button" className="kit-btn kit-btn-primary" data-focusable>
              Play Stream (Primary)
            </button>
            <button type="button" className="kit-btn" data-focusable>
              Secondary Action
            </button>
            <button type="button" className="kit-btn kit-btn-ghost" data-focusable>
              Ghost / More
            </button>
            <button type="button" className="kit-btn kit-btn-choice" aria-pressed="true" data-focusable>
              Selected Track (aria-pressed)
            </button>
            <button type="button" className="kit-btn" disabled>
              Unplayable (infoHash only)
            </button>
            <button
              type="button"
              className="kit-btn"
              onClick={() => setShowDialog((v) => !v)}
            >
              {showDialog ? "Close Pairing Dialog" : "Preview Pairing Dialog"}
            </button>
          </div>

          <div className="row-failure" role="alert" style={{ marginBottom: showDialog ? "1rem" : 0 }}>
            <div>
              <strong>Action refused by Host: </strong>
              <span>
                The Host will not play that Stream: it is an infoHash torrent and this Host has no torrent bridge configured.
              </span>
            </div>
            <span className="proto-pill-tag">role="alert"</span>
          </div>

          {showDialog ? (
            <div
              role="dialog"
              aria-label="Pair a Remote Device"
              style={{
                padding: "1.1rem 1.25rem",
                borderRadius: "var(--radius-panel)",
                border: "1px solid var(--border-strong)",
                background: "var(--bg-raised)",
              }}
            >
              <div className="row-header" style={{ marginBottom: "0.4rem" }}>
                <h4 style={{ margin: 0 }}>Pair a Remote client</h4>
                <span className="tabular" style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--accent)" }}>
                  4K7Q2M
                </span>
              </div>
              <p style={{ margin: "0 0 0.75rem", fontSize: "var(--text-caption)", color: "var(--ink-secondary)" }}>
                Open http://192.168.1.42:7878 on your phone and enter this single-use Pairing code. Redeeming it rotates the code shown here.
              </p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="kit-btn kit-btn-primary" onClick={() => setShowDialog(false)}>
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* Design Tokens Ledger */}
        <section className="kit-panel" aria-label="Design tokens">
          <h3>Design Tokens — {meta.name}</h3>
          <div className="swatch-grid" style={{ marginBottom: "1.25rem" }}>
            {[
              { name: "--bg-canvas", value: meta.canvasHex, role: "Window canvas" },
              { name: "--bg-stage", value: meta.stageHex, role: "Rail & cards" },
              { name: "--bg-raised", value: meta.raisedHex, role: "Controls & drawers" },
              { name: "--ink-primary", value: meta.inkHex, role: "Primary text" },
              { name: "--accent", value: meta.accentHex, role: meta.accentName },
            ].map((sw) => (
              <div key={sw.name} className="swatch-card">
                <div className="swatch-chip" style={{ background: sw.value }} />
                <div className="tabular" style={{ fontWeight: 700, fontSize: "var(--text-caption)" }}>
                  {sw.name}
                </div>
                <div className="tabular" style={{ fontSize: "var(--text-micro)", color: "var(--ink-secondary)" }}>
                  {sw.value} · {sw.role}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gap: "0.55rem", fontSize: "var(--text-caption)" }}>
            <div>
              <strong>Typography: </strong>
              <span style={{ color: "var(--ink-secondary)" }}>{meta.displayFont}</span>
            </div>
            <div>
              <strong>Type Scale (10-foot calibrated): </strong>
              <span className="tabular" style={{ color: "var(--ink-secondary)" }}>
                Hero (--text-hero) · Title (--text-title) · Section (1.125rem) · Body (0.95rem) · Caption (0.8125rem) · Micro (0.72rem)
              </span>
            </div>
            <div>
              <strong>Spacing & Radii: </strong>
              <span className="tabular" style={{ color: "var(--ink-secondary)" }}>
                4px/8px/12px/16px/24px/36px scale · Card radius: {variant === "A" ? "6px" : variant === "B" ? "3px" : "12px"} · Panel radius: {variant === "A" ? "12px" : variant === "B" ? "6px" : "18px"}
              </span>
            </div>
            <div>
              <strong>Motion: </strong>
              <span className="tabular" style={{ color: "var(--ink-secondary)" }}>
                Single ease-out curve · Fast {variant === "B" ? "90ms" : "140ms"} (focus/color) · Med {variant === "B" ? "160ms" : "240ms"} (card lift) · Slow {variant === "B" ? "260ms" : "400ms"} (hero slide) · respects prefers-reduced-motion
              </span>
            </div>
            <div>
              <strong>Focus Ring (D-pad): </strong>
              <span style={{ color: "var(--ink-secondary)" }}>{meta.focusRecipe}</span>
            </div>
            <div>
              <strong>Nav Rail: </strong>
              <span style={{ color: "var(--ink-secondary)" }}>{meta.railShape}</span>
            </div>
            <div>
              <strong>Hero Stage: </strong>
              <span style={{ color: "var(--ink-secondary)" }}>{meta.heroShape}</span>
            </div>
            <div>
              <strong>Poster Cards: </strong>
              <span style={{ color: "var(--ink-secondary)" }}>{meta.cardShape}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Floating bottom PrototypeSwitcher per prototype/UI.md */}
      <div className="proto-floating-switcher" role="region" aria-label="Prototype variant switcher">
        <button
          type="button"
          onClick={() => changeVariant(variant === "A" ? "C" : variant === "B" ? "A" : "B")}
          aria-label="Previous variant"
        >
          ←
        </button>
        <span>
          Variant {meta.key} ({meta.name})
        </span>
        <button
          type="button"
          onClick={() => changeVariant(variant === "A" ? "B" : variant === "B" ? "C" : "A")}
          aria-label="Next variant"
        >
          →
        </button>
      </div>
    </div>
  );
}
