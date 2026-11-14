// Manual check (needs Playwright and Chromium): npm run build:plugin && node extras/test-chrome-extension.cjs
// Loads extensions/chrome into Chromium and drives it on a mock claude.ai page.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const EXT = path.resolve(__dirname, '..', 'extensions', 'chrome');
const check = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
const MOCK = `<!doctype html><html><body style="font-family:sans-serif">
<main><div id="msgs"></div></main>
<div class="composer-wrap"><fieldset style="border:1px solid #ccc;border-radius:12px;padding:8px;margin:20px">
  <div class="ProseMirror" contenteditable="true" role="textbox" style="min-height:40px"></div>
  <button aria-label="Send message" id="send">Send</button>
</fieldset></div>
<script>window.__sent=[];document.getElementById('send').onclick=()=>{const b=document.querySelector('.ProseMirror');window.__sent.push(b.innerText);b.innerHTML='';};</script>
</body></html>`;
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-ext-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  await ctx.route('https://claude.ai/**', (r) => r.fulfill({ contentType: 'text/html', body: MOCK }));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('https://claude.ai/new');
  const host = p.locator('#ccb-prompt-buttons');
  await host.waitFor({ timeout: 10000 });
  const labels = await host.locator('button').allTextContents();
  check('row appears above the prompt box: ' + labels.join(' | '), labels.includes('Continue') && labels.includes('Regenerate'));
  check('row sits right before the box frame', await p.evaluate(() => document.getElementById('ccb-prompt-buttons').nextElementSibling.tagName === 'FIELDSET'));
  // Continue: inserts and sends.
  await host.locator('button', { hasText: 'Continue' }).click();
  await p.waitForTimeout(400);
  const sent = await p.evaluate(() => window.__sent);
  check('Continue sends the continue message', sent.length === 1 && sent[0].startsWith('Continue exactly where you stopped'));
  // Regenerate: rewrites the box, doesn't send.
  await p.click('.ProseMirror'); await p.keyboard.type('fix my code please');
  await host.locator('button', { hasText: 'Regenerate' }).click();
  await p.waitForTimeout(200);
  const box = await p.evaluate(() => document.querySelector('.ProseMirror').innerText);
  check('Regenerate builds the rewrite request without sending', box.includes('Rewrite this prompt') && box.includes('fix my code please') && (await p.evaluate(() => window.__sent.length)) === 1);
  // Save, then insert from Prompts.
  await p.evaluate(() => { document.querySelector('.ProseMirror').innerHTML = ''; });
  await p.click('.ProseMirror'); await p.keyboard.type('راجع هذا الكود بحثاً عن الأخطاء');
  await host.locator('button', { hasText: 'Save' }).click();
  await p.waitForTimeout(500);
  await p.evaluate(() => { document.querySelector('.ProseMirror').innerHTML = ''; });
  await host.locator('button', { hasText: 'Prompts' }).click();
  await host.locator('.menu .item').first().click();
  await p.waitForTimeout(200);
  check('saved prompt inserts from the Prompts menu', (await p.evaluate(() => document.querySelector('.ProseMirror').innerText)).includes('راجع هذا الكود'));
  // Popup: add a button, import a ccb export.
  const id = [...crypto.createHash('sha256').update(EXT).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const pop = await ctx.newPage(); pop.on('pageerror', (e) => errs.push('popup: ' + e.message));
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.fill('#b-label', 'Review'); await pop.fill('#b-text', 'Review this diff for bugs'); await pop.click('#b-add');
  await pop.waitForTimeout(400);
  const exp = { format: 'ccb-export/1', schemaVersion: 1, prompts: [{ id: '01JABCDEFGHJKMNPQRSTVWXYZ0', updatedAt: '2026-11-10T07:00:00.000Z', updatedBy: 'dev_laptop01', deletedAt: null, ancestors: [], title: 'From laptop', body: 'Plugin prompt body', category: null, tags: [], favorite: true, useCount: 0, lastUsedAt: null, createdAt: '2026-11-10T07:00:00.000Z', conflictOf: null }] };
  const f = path.join(dir, 'in.json'); fs.writeFileSync(f, JSON.stringify(exp));
  await pop.setInputFiles('#import', f); await pop.waitForTimeout(500);
  check('popup imported a ccb export: ' + (await pop.textContent('#msg')), (await pop.textContent('#prompts')).includes('From laptop'));
  // The page row picks up the new button through storage changes; pressing it sends.
  await p.bringToFront(); await p.waitForTimeout(500);
  const review = host.locator('button', { hasText: 'Review' });
  check('new button appears on the page without reload', (await review.count()) === 1);
  await review.click(); await p.waitForTimeout(400);
  check('custom button sends its text', (await p.evaluate(() => window.__sent)).includes('Review this diff for bugs'));
  // Re-attaches after the page swaps the composer (SPA navigation).
  await p.evaluate(() => { const w = document.querySelector('.composer-wrap'); w.innerHTML = w.innerHTML; });
  await p.waitForTimeout(800);
  check('row re-attaches after the page redraws the box', await p.evaluate(() => { const h = document.getElementById('ccb-prompt-buttons'); return !!h && h.nextElementSibling && h.nextElementSibling.tagName === 'FIELDSET'; }));
  check('no errors', errs.length === 0); if (errs.length) console.log(errs);
  await p.screenshot({ path: path.join(os.tmpdir(), 'ccb-extension.png') });
  await ctx.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
