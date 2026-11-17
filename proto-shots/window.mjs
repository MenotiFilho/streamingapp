import { chromium } from '/opt/pw/node_modules/playwright-core/index.mjs';
const b = await chromium.launch();
for (const v of ['A','B','C']) {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', e => console.log('PAGEERR', v, e.message));
  await p.goto(`http://127.0.0.1:1430/?proto=autoplay&variant=${v}`, { waitUntil: 'networkidle' }).catch(()=>{});
  await p.waitForTimeout(1500);
  await p.mouse.move(800, 450);
  await p.waitForTimeout(300);
  // the switch
  if (v === 'B') await p.click('[data-testid="osd-episodes"]').catch(e=>console.log('B open fail'));
  if (v === 'C') await p.click('[data-testid="osd-speed"]').catch(e=>console.log('C open fail'));
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `proto-shots/window-${v}-switch.png` });
  if (v !== 'A') await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.click('[data-testid="proto-end"]');
  await p.waitForTimeout(1800);
  await p.screenshot({ path: `proto-shots/window-${v}-countdown.png` });
  await p.click('[data-testid="proto-cancel"]').catch(e=>console.log(v,'cancel fail'));
  await p.waitForTimeout(500);
  await p.mouse.move(820, 460);
  await p.screenshot({ path: `proto-shots/window-${v}-held.png` });
  await p.close();
}
await b.close();
