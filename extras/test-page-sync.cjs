// Manual check (needs Playwright and Chromium): npm run build && node extras/test-page-sync.cjs
// End-to-end: the page (headless browser, Drive simulated by a local folder that stands
// in for Google Drive for desktop) and the real plugin CLI in drive-folder mode.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-e2e-'));
const DRIVE = path.join(tmp, 'MyDrive'); fs.mkdirSync(DRIVE);
const FOLDER = path.join(DRIVE, 'Claude Codex Buttons'); fs.mkdirSync(FOLDER);
const HOME = path.join(tmp, 'home');
const ccb = (...a) => cp.execFileSync('node', [path.join(REPO, 'packages/cli/dist/bin.js'), '--home', HOME, ...a], { encoding: 'utf8' });
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) process.exitCode = 1; };

// Drive mock: ids are paths relative to DRIVE.
const abs = (id) => path.join(DRIVE, id || '');
const meta = (id) => { const st = fs.statSync(abs(id)); return { id, title: path.basename(id), modifiedTime: st.mtime.toISOString(), mimeType: st.isDirectory() ? 'application/vnd.google-apps.folder' : 'application/json', trashed: false }; };
function driveCall(tool, input) {
  if (tool === 'search_files') {
    const q = input.query; let m;
    const parent = (m = /parentId = '([^']*)'/.exec(q)) ? m[1].replace(/\\'/g, "'") : null;
    const titleEq = (m = /title = '([^']*)'/.exec(q)) ? m[1] : null;
    const titleHas = (m = /title contains '([^']*)'/.exec(q)) ? m[1].replace(/\\'/g, "'") : null;
    const wantFolder = q.includes("mimeType = 'application/vnd.google-apps.folder'");
    const dirs = parent !== null ? [parent] : ['', ...fs.readdirSync(DRIVE)];
    const files = [];
    for (const d of dirs) for (const n of fs.readdirSync(abs(d))) {
      const id = path.join(d, n), md = meta(id);
      if (wantFolder && md.mimeType !== 'application/vnd.google-apps.folder') continue;
      if (titleEq && n !== titleEq) continue;
      if (titleHas && !n.toLowerCase().includes(titleHas.toLowerCase())) continue;
      files.push(md);
    }
    return { payload: { files } };
  }
  if (tool === 'create_file') {
    const id = path.join(input.parentId || '', input.title);
    if (input.contentMimeType === 'application/vnd.google-apps.folder') fs.mkdirSync(abs(id), { recursive: true });
    else fs.writeFileSync(abs(id), input.textContent);
    return { payload: meta(id) };
  }
  if (tool === 'trash_file') { fs.rmSync(abs(input.fileId), { recursive: true, force: true }); return { payload: {} }; }
  if (tool === 'download_file_content') {
    const blob = fs.readFileSync(abs(input.fileId)).toString('base64');
    return { payload: { id: input.fileId, content: '(file sent separately)' }, content: [{ type: 'resource', resource: { uri: 'googledrive://x', mimeType: 'application/json', blob } }] };
  }
  throw new Error('unknown tool ' + tool);
}

(async () => {
  // 1. The plugin on "your computer": a prompt, synced into the Drive folder.
  ccb('config', 'set', 'sync.mode', 'drive-folder');
  ccb('config', 'set', 'sync.folderPath', FOLDER);
  fs.writeFileSync(path.join(tmp, 'in.json'), JSON.stringify({ format: 'ccb-export/1', schemaVersion: 1, prompts: [{ id: '01JABCDEFGHJKMNPQRSTVWXYZ0', updatedAt: '2026-11-10T07:00:00.000Z', updatedBy: 'dev_laptop01', deletedAt: null, ancestors: [], title: 'From laptop', body: 'Plugin prompt body', category: null, tags: [], favorite: false, useCount: 0, lastUsedAt: null, createdAt: '2026-11-10T07:00:00.000Z', conflictOf: null }] }));
  ccb('import', path.join(tmp, 'in.json'));
  console.log(ccb('sync').trim());
  check('plugin wrote its device file', fs.readdirSync(path.join(FOLDER, 'devices')).some((n) => /^dev_.*\.json$/.test(n)));

  // 2. The page picks the folder and syncs.
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.exposeFunction('__drive', (tool, input) => driveCall(tool, input));
  await p.addInitScript(() => {
    window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } } });
    const mcp = { callTool: (s, t, i) => window.__drive(t, i) };
    window.claude = { use: async (n) => (n === 'mcp' ? mcp : null) };
  });
  const html = fs.readFileSync(path.join(REPO, 'extras', 'prompt-buttons-page.html'), 'utf8');
  const wrapped = path.join(tmp, 'page.html');
  fs.writeFileSync(wrapped, '<!doctype html><html><head><meta charset=utf8></head><body>' + html + '</body></html>');
  await p.goto('file://' + wrapped);
  await p.waitForTimeout(500);
  await p.click('#t-drive'); await p.fill('#drive-q', 'Claude Codex'); await p.click('#drive-search');
  await p.waitForSelector('#drive-results .btn.primary'); await p.click('#drive-results .btn.primary');
  await p.waitForFunction(() => document.getElementById('drive-status').textContent.includes('آخر مزامنة'), null, { timeout: 15000 });
  const bank = await p.textContent('#bank-list');
  check('page shows the plugin prompt', bank.includes('From laptop'));

  // 3. Add a prompt and a button in the page; it uploads its device file.
  await p.click('#t-bank'); await p.click('#bank-new summary');
  await p.fill('#new-title', 'من الصفحة'); await p.fill('#new-body', 'نص من الصفحة'); await p.click('#new-save');
  await p.click('#t-buttons'); await p.click('#p-buttons details summary');
  await p.fill('#btn-label', 'لخّص'); await p.fill('#btn-text', 'لخّص في 3 نقاط'); await p.click('#btn-save');
  await p.evaluate(() => document.getElementById('drive-sync').click());
  await p.waitForTimeout(3500);
  const pageFiles = fs.readdirSync(path.join(FOLDER, 'devices')).filter((n) => n.startsWith('dev_page'));
  check('page wrote exactly one device file', pageFiles.length === 1);

  // 4. The plugin syncs and sees them.
  console.log(ccb('sync').trim());
  let lib = JSON.parse(ccb('export'));
  const live = (a) => a.filter((r) => !r.deletedAt);
  check('plugin got the page prompt', live(lib.prompts).some((x) => x.title === 'من الصفحة'));
  check('plugin got the page button', live(lib.buttons).some((x) => x.label === 'لخّص'));
  check('plugin kept its own prompt', live(lib.prompts).some((x) => x.title === 'From laptop'));

  // 5. Delete the laptop prompt in the page; the deletion reaches the plugin.
  await p.click('#t-bank');
  const del = p.locator('#bank-list .item', { hasText: 'From laptop' }).locator('button', { hasText: 'حذف' });
  await del.click(); await del.click();
  await p.evaluate(() => document.getElementById('drive-sync').click());
  await p.waitForTimeout(3500);
  console.log(ccb('sync').trim());
  lib = JSON.parse(ccb('export'));
  check('deletion reached the plugin', !live(lib.prompts).some((x) => x.title === 'From laptop'));
  check('page prompt still there', live(lib.prompts).some((x) => x.title === 'من الصفحة'));

  // 6. Edit on the plugin side reaches the page.
  const pagePrompt = live(lib.prompts).find((x) => x.title === 'من الصفحة');
  fs.writeFileSync(path.join(tmp, 'in2.json'), JSON.stringify({ format: 'ccb-export/1', schemaVersion: 1, prompts: [{ ...pagePrompt, title: 'من الصفحة (عُدّل على الجهاز)', updatedAt: new Date(Date.now() + 1000).toISOString(), updatedBy: 'dev_laptop01', ancestors: [] }] }));
  ccb('import', path.join(tmp, 'in2.json')); console.log(ccb('sync').trim());
  await p.evaluate(() => document.getElementById('drive-sync').click());
  await p.waitForTimeout(3500);
  const bank2 = await p.textContent('#bank-list');
  check('plugin edit reached the page (as edit or conflict copy)', bank2.includes('عُدّل على الجهاز'));
  check('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  console.log('device files:', fs.readdirSync(path.join(FOLDER, 'devices')));
  await b.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
