// PROTOTYPE (#307, throwaway — never merged): Playwright screenshot harness for Window and Remote variants A/B/C.
import { deflateSync } from "node:zlib";
import { chromium } from "/opt/pw/node_modules/playwright-core/index.mjs";

const BASE = "http://127.0.0.1:1420";
const VARIANTS = ["A", "B", "C"];
const STATES = [
  "finding-5",
  "fetching",
  "fetching-0",
  "stalled-torrent",
  "stalled-direct",
  "playing",
  "failed-nobody",
];

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([len, tag, data, crc]);
}

function solid1x1Png(r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([0, r, g, b]);
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const DARK_PNG = solid1x1Png(26, 22, 18);

const CANNED_MOVIES = [
  {
    id: "tt15239678",
    imdb_id: "tt15239678",
    type: "movie",
    name: "Dune: Part Two",
    poster: "https://images.metahub.space/poster/small/tt15239678/img",
    background: "https://images.metahub.space/background/medium/tt15239678/img",
    releaseInfo: "2024",
    imdbRating: "8.5",
    runtime: "166 min",
    genres: ["Sci-Fi", "Adventure", "Drama"],
    description:
      "Paul Atreides unites with Chani and the Fremen while on a warpath of revenge against the conspirators who destroyed his family.",
  },
  {
    id: "tt1856101",
    imdb_id: "tt1856101",
    type: "movie",
    name: "Blade Runner 2049",
    poster: "https://images.metahub.space/poster/small/tt1856101/img",
    background: "https://images.metahub.space/background/medium/tt1856101/img",
    releaseInfo: "2017",
    imdbRating: "8.0",
    runtime: "164 min",
    genres: ["Sci-Fi", "Drama", "Mystery"],
    description:
      "Young Blade Runner K's discovery of a long-buried secret leads him to track down former Blade Runner Rick Deckard.",
  },
  {
    id: "tt0133093",
    imdb_id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    poster: "https://images.metahub.space/poster/small/tt0133093/img",
    background: "https://images.metahub.space/background/medium/tt0133093/img",
    releaseInfo: "1999",
    imdbRating: "8.7",
    runtime: "136 min",
    genres: ["Action", "Sci-Fi"],
    description:
      "A computer hacker learns from mysterious rebels about the true nature of his reality and his role in the war against its controllers.",
  },
  {
    id: "tt0816692",
    imdb_id: "tt0816692",
    type: "movie",
    name: "Interstellar",
    poster: "https://images.metahub.space/poster/small/tt0816692/img",
    background: "https://images.metahub.space/background/medium/tt0816692/img",
    releaseInfo: "2014",
    imdbRating: "8.7",
    runtime: "169 min",
    genres: ["Adventure", "Drama", "Sci-Fi"],
    description:
      "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
  },
];

async function installRoutes(context) {
  await context.route("https://v3-cinemeta.strem.io/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/meta/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ meta: CANNED_MOVIES[0] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ metas: CANNED_MOVIES, hasMore: false }),
    });
  });

  await context.route("https://torrentio.strem.fun/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        streams: [
          {
            name: "Torrentio\n1080p",
            title: "Dune.Part.Two.2024.1080p.WEB-DL\n👤 42 💾 8.4 GB",
            infoHash: "0123456789abcdef0123456789abcdef01234567",
          },
        ],
      }),
    });
  });

  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:")) {
      await route.continue();
      return;
    }
    if (req.resourceType() === "image" || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(url) || url.includes("metahub.space")) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: DARK_PNG,
      });
      return;
    }
    await route.abort();
  });
}

const browser = await chromium.launch();
const errors = [];

try {
  // 1. Window (1600x900)
  const winCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await installRoutes(winCtx);

  for (const v of VARIANTS) {
    for (const s of STATES) {
      const page = await winCtx.newPage();
      page.on("pageerror", (e) => errors.push(`window-${v}-${s}: ${e.message}`));
      await page.goto(`${BASE}/?proto=torrent&variant=${v}&state=${s}`, {
        waitUntil: "networkidle",
      }).catch(() => {});

      const waitMs =
        s === "stalled-torrent" || s === "stalled-direct"
          ? v === "B"
            ? 1400
            : 3500
          : 1200;
      await page.waitForTimeout(waitMs);
      await page.screenshot({ path: `proto-shots/window-${v}-${s}.png` });
      await page.close();
    }
  }
  await winCtx.close();

  // 2. Remote (390x844)
  const remCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installRoutes(remCtx);

  for (const v of VARIANTS) {
    for (const s of STATES) {
      const page = await remCtx.newPage();
      page.on("pageerror", (e) => errors.push(`remote-${v}-${s}: ${e.message}`));
      await page.goto(`${BASE}/remote.html?proto=torrent&variant=${v}&state=${s}`, {
        waitUntil: "networkidle",
      }).catch(() => {});

      if (s === "failed-nobody") {
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `proto-shots/remote-${v}-${s}.png` });
      } else {
        await page.waitForSelector(".remote-player-strip-open", { timeout: 5000 });
        if (s === "stalled-torrent") {
          await page.waitForTimeout(1300);
          await page.screenshot({ path: `proto-shots/remote-${v}-strip.png` });
        }
        await page.click(".remote-player-strip-open");
        await page.waitForSelector('[data-testid="remote-player-card"]', { timeout: 5000 });
        if (s === "playing" && v === "A") {
          await page.click('[data-testid="player-menu-picture"]');
          await page.waitForSelector('[data-testid="player-sheet-picture"]', { timeout: 5000 });
        }
        await page.waitForTimeout(1300);
        await page.screenshot({ path: `proto-shots/remote-${v}-${s}.png` });
      }
      await page.close();
    }
  }
  await remCtx.close();
} finally {
  await browser.close();
}

if (errors.length > 0) {
  console.error("PAGE ERRORS:", errors);
  process.exit(1);
}
console.log("Captured all screenshots cleanly.");
