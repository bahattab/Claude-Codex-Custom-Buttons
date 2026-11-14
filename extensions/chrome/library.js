// The extension's library, shared by the page buttons (content.js) and the popup.
// It is the plugin's own format (packages/core, bundled in ccb-core.js as CCB), so
// `ccb export` files import here and this extension's exports import into the plugin.
//
// Storage: chrome.storage.sync, which Chrome keeps the same on every computer where you
// are signed in to Chrome with your Google account. Sync storage is small (about 100 KB,
// 8 KB per key), so the library is split into chunks; a library too big for it is kept
// in chrome.storage.local on this computer only.
/* global CCB */
(() => {
  const CHUNK = 7000; // characters per key, under the 8 KB per-item limit
  const MAX_SYNC = 90000;
  const PREFIX = "lib_";

  const area = (name) => chrome.storage[name];
  const get = (name, keys) => new Promise((res) => area(name).get(keys, (v) => res(v || {})));
  const set = (name, items) => new Promise((res, rej) => area(name).set(items, () => (chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())));
  const remove = (name, keys) => new Promise((res) => area(name).remove(keys, () => res()));

  function randomDeviceId() {
    const a = "abcdefghijklmnopqrstuvwxyz0123456789";
    const r = new Uint8Array(10);
    crypto.getRandomValues(r);
    return "dev_chrome" + Array.from(r, (n) => a[n % a.length]).join("");
  }

  async function deviceId() {
    const { deviceId: id } = await get("local", ["deviceId"]);
    if (id) return id;
    const fresh = randomDeviceId();
    await set("local", { deviceId: fresh });
    return fresh;
  }

  async function load() {
    const all = await get("sync", null);
    const n = Number(all.lib_n || 0);
    if (n > 0) {
      let text = "";
      for (let i = 0; i < n; i++) text += all[PREFIX + i] || "";
      try {
        return { library: { ...CCB.emptyLibrary(), ...JSON.parse(text) }, where: "sync" };
      } catch (_) {
        /* fall through to local */
      }
    }
    const { library } = await get("local", ["library"]);
    return { library: library ? { ...CCB.emptyLibrary(), ...library } : CCB.emptyLibrary(), where: library ? "local" : "sync" };
  }

  /** Saves the synced part of the library. Returns where it went: "sync" or "local". */
  async function save(library) {
    const data = {};
    for (const c of ["prompts", "categories", "variables", "buttons", "notes", "sharedSettings"]) data[c] = library[c] || [];
    const text = JSON.stringify(data);
    const old = await get("sync", ["lib_n"]);
    const oldN = Number(old.lib_n || 0);
    if (text.length <= MAX_SYNC) {
      const items = {};
      const n = Math.max(1, Math.ceil(text.length / CHUNK));
      for (let i = 0; i < n; i++) items[PREFIX + i] = text.slice(i * CHUNK, (i + 1) * CHUNK);
      items.lib_n = n;
      try {
        await set("sync", items);
        const stale = [];
        for (let i = n; i < oldN; i++) stale.push(PREFIX + i);
        if (stale.length) await remove("sync", stale);
        await remove("local", ["library"]);
        return "sync";
      } catch (_) {
        /* quota: keep it on this computer */
      }
    }
    await set("local", { library: data });
    return "local";
  }

  /** Runs one plugin operation and saves the result. */
  async function edit(op) {
    const { library } = await load();
    const ctx = { now: new Date().toISOString(), deviceId: await deviceId() };
    const r = op(library, ctx);
    if (!r.ok) return { ok: false, errors: r.errors };
    const where = await save(r.value.library);
    return { ok: true, library: r.value.library, where };
  }

  /** Merges a `ccb export` (or device file) into the library, as `ccb import` does. */
  async function importDoc(raw) {
    if (!raw || (raw.format !== "ccb-export/1" && raw.format !== "ccb-device/1")) return { ok: false, errors: ["This isn't a ccb export file."] };
    const candidate = {
      format: "ccb-device/1",
      schemaVersion: raw.schemaVersion ?? 1,
      deviceId: "dev_importfile",
      deviceName: "Imported file",
      syncedAt: new Date().toISOString(),
      prompts: raw.prompts ?? [],
      categories: raw.categories ?? [],
      variables: raw.variables ?? [],
      buttons: raw.buttons ?? [],
      notes: raw.notes ?? [],
      sharedSettings: raw.sharedSettings ?? [],
    };
    const checked = CCB.validateDeviceFile(candidate);
    if (!checked.ok) return { ok: false, errors: checked.errors };
    const { library } = await load();
    const now = new Date().toISOString();
    const result = CCB.merge({ local: library, remotes: [checked.value], base: CCB.emptyBase(), now, deviceId: await deviceId() });
    const merged = { ...library, ...result.data };
    const where = await save(merged);
    return { ok: true, library: merged, where };
  }

  async function exportText() {
    const { library } = await load();
    const doc = { format: "ccb-export/1", schemaVersion: 1, exportedAt: new Date().toISOString(), deviceId: await deviceId() };
    for (const c of ["prompts", "categories", "variables", "buttons", "notes", "sharedSettings"]) doc[c] = library[c] || [];
    return JSON.stringify(doc, null, 2) + "\n";
  }

  const prompts = (library) => CCB.live(library.prompts);
  const buttons = (library) => CCB.live(library.buttons).slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const newButtonId = () => "btn_" + CCB.ulid(Date.now(), Math.random).toLowerCase();

  /** Called with the new library whenever another tab or computer changes it. */
  function onChange(fn) {
    chrome.storage.onChanged.addListener((changes, name) => {
      if ((name === "sync" && Object.keys(changes).some((k) => k === "lib_n" || k.startsWith(PREFIX))) || (name === "local" && changes.library)) {
        load().then(({ library }) => fn(library));
      }
    });
  }

  globalThis.CCBLibrary = { load, save, edit, importDoc, exportText, prompts, buttons, newButtonId, onChange, deviceId };
})();
