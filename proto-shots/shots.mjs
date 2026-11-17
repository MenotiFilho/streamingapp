// PROTOTYPE (#300): screenshots of each variant, window and Remote.
import { chromium } from '/opt/pw/node_modules/playwright-core/index.mjs';
const b = await chromium.launch();
const base = 'http://127.0.0.1:1430';
const only = process.argv[2];
for (const v of ['A','B','C','D']) {
  if (only && only !== v) continue;
  for (const seed of ['migrated', 'full', 'empty']) {
    // window
    let p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    p.on('pageerror', e => console.log('PAGEERR', v, e.message));
    await p.goto(`${base}/?proto=languages&variant=${v}&seed=${seed}`, { waitUntil: 'networkidle' }).catch(()=>{});
    await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'Settings' }).first().click({ timeout: 4000 }).catch(() => console.log('no win settings'));
    await p.waitForTimeout(600);
    await p.getByRole('button', { name: /preferences/i }).first().click({ timeout: 3000 }).catch(() => console.log('no prefs'));
    await p.waitForTimeout(800);
    await p.screenshot({ path: `proto-shots/window-${v}-${seed}.png` });
    if (seed === 'migrated') {
      // open the picker
      const opener = v === 'A' ? p.locator('.proto-slot').nth(1) : v === 'B' ? p.getByRole('button', { name: /add a fallback|add a language/i }).first() : v === 'D' ? p.locator('.proto-field-open').first() : null;
      if (opener) { await opener.click().catch(e => console.log('open fail', v)); await p.waitForTimeout(400); await p.screenshot({ path: `proto-shots/window-${v}-picker.png` }); }
    }
    await p.close();
    // remote
    p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    p.on('pageerror', e => console.log('PAGEERR remote', v, e.message));
    await p.goto(`${base}/remote.html?proto=languages&variant=${v}&seed=${seed}`, { waitUntil: 'networkidle' }).catch(()=>{});
    await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /settings/i }).first().click({ timeout: 4000 }).catch(() => console.log('no remote settings'));
    await p.waitForTimeout(600);
    await p.getByText('Preferences', { exact: true }).first().click({ timeout: 4000 }).catch(() => console.log('no remote prefs'));
    await p.waitForTimeout(800);
    await p.screenshot({ path: `proto-shots/remote-${v}-${seed}.png` });
    if (seed === 'migrated') {
      const opener = v === 'A' ? p.locator('.proto-slot').nth(1) : v === 'B' ? p.getByRole('button', { name: /add a fallback|add a language/i }).first() : v === 'D' ? p.locator('.proto-field-open').first() : null;
      if (opener) { await opener.click().catch(e => console.log('ropen fail', v)); await p.waitForTimeout(500); await p.screenshot({ path: `proto-shots/remote-${v}-picker.png` }); }
    }
    await p.close();
  }
}
await b.close();
