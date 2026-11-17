import { chromium } from '/opt/pw/node_modules/playwright-core/index.mjs';
const [url, out, w='1600', h='900', steps='[]'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,200)); });
await p.goto(url, { waitUntil: 'networkidle' }).catch(e=>console.log('goto', e.message));
await p.waitForTimeout(1500);
for (const s of JSON.parse(steps)) {
  if (s.click) await p.click(s.click, { timeout: 5000 }).catch(e=>console.log('click fail', s.click));
  if (s.move) await p.mouse.move(s.move[0], s.move[1]);
  if (s.key) await p.keyboard.press(s.key);
  if (s.wait) await p.waitForTimeout(s.wait);
  if (s.shot) await p.screenshot({ path: s.shot });
}
await p.screenshot({ path: out });
await b.close();
