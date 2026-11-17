import { chromium } from '/opt/pw/node_modules/playwright-core/index.mjs';
const b = await chromium.launch();
const tryClick = async (p, sel, tag) => p.click(sel, { timeout: 4000 }).catch(() => console.log('FAIL', tag, sel));
for (const v of ['A','B','C']) {
  let p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  p.on('pageerror', e => console.log('PAGEERR', v, e.message));
  await p.goto(`http://127.0.0.1:1430/remote.html?proto=autoplay&variant=${v}`, { waitUntil: 'networkidle' }).catch(()=>{});
  await p.waitForTimeout(1500);
  await tryClick(p, '.remote-player-strip-open', 'strip');
  await p.waitForTimeout(800);
  if (v === 'B') { await tryClick(p, '[data-testid="player-menu-episodes"]', 'sheet'); await p.waitForTimeout(2500); }
  await p.screenshot({ path: `proto-shots/remote-${v}-switch.png` });
  if (v === 'B') { await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
  await tryClick(p, '[data-testid="proto-end"]', 'end');
  await p.waitForTimeout(1800);
  await p.screenshot({ path: `proto-shots/remote-${v}-countdown.png` });
  await p.close();

  p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await p.goto(`http://127.0.0.1:1430/remote.html?proto=settings&variant=${v}`, { waitUntil: 'networkidle' }).catch(()=>{});
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /settings/i }).first().click({ timeout: 4000 }).catch(async () => { console.log('no settings btn'); });
  await p.waitForTimeout(800);
  await p.getByText('Preferences', { exact: true }).first().click({ timeout: 4000 }).catch(() => console.log('no remote prefs'));
  await p.waitForTimeout(800);
  const h = p.getByRole('heading', { name: /up next|when an episode ends|autoplay/i }).first();
  await h.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(()=>console.log('no heading', v));
  await p.evaluate(() => window.scrollBy(0, -80));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `proto-shots/remote-${v}-settings.png` });
  await p.close();

  p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await p.goto(`http://127.0.0.1:1430/?proto=settings&variant=${v}`, { waitUntil: 'networkidle' }).catch(()=>{});
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Settings' }).first().click({ timeout: 4000 }).catch(() => console.log('no win settings'));
  await p.waitForTimeout(800);
  console.log(v, 'win settings buttons:', (await p.$$eval('button', els => els.map(e => e.textContent.trim().slice(0,18)).filter(Boolean))).slice(0,30).join('|'));
  await p.getByRole('button', { name: /preferences/i }).first().click({ timeout: 3000 }).catch(() => console.log('no prefs'));
  await p.waitForTimeout(800);
  await p.locator('#settings-up-next, [data-region="settings-up-next"]').first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(()=>console.log('no group'));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `proto-shots/window-${v}-settings.png` });
  await p.close();
}
await b.close();
