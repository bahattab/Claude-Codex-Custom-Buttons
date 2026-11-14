// The button row above the prompt box on claude.ai (chats and claude.ai/code sessions).
// Buttons put text into the prompt box the way typing does; nothing is sent anywhere
// except to Claude, by Claude's own Send button. The row lives in a shadow root, so
// claude.ai's styles and ours don't mix, and it re-attaches when the page changes.
/* global CCB, CCBLibrary */
(() => {
  if (window.__ccbButtons) return;
  window.__ccbButtons = true;

  const HOST_ID = "ccb-prompt-buttons";
  const QUICK_LANGS = ["English", "Arabic", "French", "Spanish", "German", "Turkish", "Urdu", "Persian", "Indonesian", "Chinese (Simplified)", "Japanese", "Hindi"];
  let library = CCB.emptyLibrary();

  // ---------- the prompt box ----------
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /** The prompt box: claude.ai's editor (ProseMirror), else the lowest visible text box. */
  function findComposer() {
    const pm = [...document.querySelectorAll('div.ProseMirror[contenteditable="true"]')].filter(visible);
    if (pm.length) return pm[pm.length - 1];
    const editable = [...document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]')].filter(visible);
    if (editable.length) return editable.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop();
    const ta = [...document.querySelectorAll("textarea")].filter(visible);
    return ta.length ? ta[ta.length - 1] : null;
  }
  /** The block the box sits in (its rounded frame), so the row goes just above it. */
  function frameOf(box) {
    const stop = box.closest("form, fieldset");
    if (stop) return stop;
    let el = box;
    for (let i = 0; i < 6 && el.parentElement && el.parentElement !== document.body; i++) {
      el = el.parentElement;
      if (el.querySelector("button") && el.getBoundingClientRect().width >= box.getBoundingClientRect().width) return el;
    }
    return box.parentElement;
  }
  function boxText(box) {
    return box.tagName === "TEXTAREA" ? box.value : box.innerText.replace(/\n$/, "");
  }
  /** Puts text into the box as if typed: replace (default), or add after what's there. */
  function putText(box, text, mode = "replace") {
    box.focus();
    if (box.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, mode === "append" && box.value ? box.value + "\n\n" + text : text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    if (mode === "append") range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const insert = mode === "append" && boxText(box).trim() ? "\n\n" + text : text;
    const before = boxText(box);
    let ok;
    try {
      ok = document.execCommand("insertText", false, insert);
    } catch (_) {
      ok = false;
    }
    if (!ok || boxText(box) === before) {
      box.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: insert, bubbles: true, cancelable: true }));
    }
  }
  function sendButton(box) {
    const scope = frameOf(box) || document;
    const pick = (root) =>
      root.querySelector('button[aria-label="Send message"], button[aria-label*="Send" i], button[data-testid*="send" i], button[type="submit"]');
    return pick(scope) || pick(document);
  }
  function send(box) {
    setTimeout(() => {
      const btn = sendButton(box);
      if (btn && !btn.disabled) btn.click();
      else box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }, 120);
  }

  // ---------- actions ----------
  const continueText = () => {
    const s = CCB.live(library.sharedSettings || []).find((x) => x.id === "continue.message");
    return (s && s.value) || CCB.DEFAULT_CONTINUE_MESSAGE;
  };
  const promptBody = (id) => (CCB.live(library.prompts).find((p) => p.id === id) || {}).body;

  function doContinue() {
    const box = findComposer();
    if (!box) return toast("I can't find the prompt box on this page.");
    putText(box, continueText());
    send(box);
  }
  /** Asks Claude, in this conversation, to rewrite the prompt in the box. You see it first. */
  function doRegenerate() {
    const box = findComposer();
    if (!box) return toast("I can't find the prompt box on this page.");
    const text = boxText(box).trim();
    if (!text) return toast("Type a prompt first, then press Regenerate.");
    putText(box, `${CCB.REFINE_INSTRUCTIONS}\n\nRewrite this prompt:\n\n${text}`);
    toast("Rewrite request ready: press Send, then use the rewritten prompt.");
  }
  function doTranslate(lang) {
    const box = findComposer();
    if (!box) return toast("I can't find the prompt box on this page.");
    const text = boxText(box).trim();
    if (!text) return toast("Type or paste the text to translate first.");
    putText(box, `${CCB.TRANSLATE_INSTRUCTIONS}\n\nTranslate into ${lang}.\n\n<text>\n${text}\n</text>`);
    send(box);
  }
  function runButton(b) {
    const a = b.action || {};
    const box = findComposer();
    if (!box) return toast("I can't find the prompt box on this page.");
    if (a.type === "continue") return doContinue();
    if (a.type === "refine") return doRegenerate();
    if (a.type === "insert-prompt" || a.type === "open-pane") return openPrompts(a.search || "");
    const text = typeof a.text === "string" ? a.text : promptBody(a.promptId);
    if (!text) return toast(`The prompt behind “${b.label}” was deleted.`);
    if (a.type === "submit") {
      putText(box, text);
      send(box);
    } else {
      putText(box, text, a.mode === "append" ? "append" : "replace");
    }
  }
  async function saveCurrent() {
    const box = findComposer();
    const body = box ? boxText(box).trim() : "";
    if (!body) return toast("Type the prompt you want to save first.");
    const title = body.split("\n").find((l) => l.trim()).trim().slice(0, 80);
    const r = await CCBLibrary.edit((lib, ctx) => CCB.savePrompt(lib, { title, body }, ctx, Math.random));
    if (!r.ok) return toast(r.errors.join("; "));
    library = r.library;
    toast(`Saved “${title}” to your Prompt Bank${r.where === "local" ? " (on this computer only: the library is too big for Chrome sync)" : ""}.`);
  }

  // ---------- the row ----------
  let shadow = null;
  let host = null;
  const CSS = `
    :host { all: initial; display: block; }
    .row { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 0 8px; font: 500 13px/1.2 system-ui, "Segoe UI", sans-serif; direction: ltr; }
    button { font: inherit; border: 1px solid rgba(127,127,127,.35); background: rgba(127,127,127,.12); color: inherit; border-radius: 8px; padding: 6px 11px; cursor: pointer; max-width: 16em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button:hover { border-color: #d97757; }
    button:focus-visible { outline: 2px solid #d97757; outline-offset: 1px; }
    button.main { background: #d97757; border-color: #d97757; color: #fff; }
    .menu { position: absolute; z-index: 2147483000; bottom: calc(100% + 4px); left: 0; width: min(420px, 92vw); max-height: 50vh; overflow: auto; background: var(--bg, #fff); color: var(--fg, #1f1f1f); border: 1px solid rgba(127,127,127,.35); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.25); padding: 8px; display: grid; gap: 6px; direction: auto; }
    .menu input { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; }
    .item { text-align: start; white-space: normal; max-width: none; background: transparent; }
    .item small { display: block; opacity: .7; font-weight: 400; margin-top: 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .wrap { position: relative; }
    .toast { position: absolute; bottom: calc(100% + 4px); right: 0; background: #1f1f1f; color: #fff; padding: 6px 10px; border-radius: 8px; font-weight: 400; max-width: 90vw; }
    @media (prefers-color-scheme: dark) { .menu { --bg: #262624; --fg: #ececec; } }
  `;
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  let toastTimer;
  function toast(msg) {
    if (!shadow) return;
    shadow.querySelector(".toast")?.remove();
    const t = el("div", { class: "toast", role: "status" }, msg);
    shadow.querySelector(".wrap").appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3500);
  }
  function closeMenus() {
    shadow?.querySelectorAll(".menu").forEach((m) => m.remove());
  }
  function menu() {
    closeMenus();
    const m = el("div", { class: "menu" });
    shadow.querySelector(".wrap").appendChild(m);
    // Opens upwards, over the conversation; when the box is near the top (a new chat), downwards.
    requestAnimationFrame(() => {
      if (m.getBoundingClientRect().top < 8) {
        m.style.bottom = "auto";
        m.style.top = "calc(100% + 4px)";
      }
    });
    return m;
  }
  function openPrompts(query = "") {
    const m = menu();
    const q = el("input", { type: "search", placeholder: "Search your prompts", "aria-label": "Search your prompts" });
    q.value = query;
    const list = el("div", { style: "display:grid;gap:4px" });
    m.append(q, list);
    const draw = () => {
      list.textContent = "";
      const words = q.value.trim().toLowerCase();
      const rows = CCBLibrary.prompts(library)
        .filter((p) => !words || (p.title + " " + p.body).toLowerCase().includes(words))
        .sort((a, b) => b.favorite - a.favorite || String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, 50);
      if (!rows.length) {
        list.append(el("div", { style: "opacity:.7;padding:6px" }, CCBLibrary.prompts(library).length ? "No prompt matches." : "Your Prompt Bank is empty. Save a prompt with ☆ Save, or import one from the extension's popup."));
        return;
      }
      for (const p of rows) {
        const b = el("button", { class: "item", type: "button", dir: "auto" }, (p.favorite ? "★ " : "") + p.title);
        b.append(el("small", { dir: "auto" }, p.body));
        b.addEventListener("click", () => {
          const box = findComposer();
          if (box) putText(box, p.body);
          closeMenus();
        });
        list.append(b);
      }
    };
    q.addEventListener("input", draw);
    q.addEventListener("keydown", (e) => e.key === "Escape" && closeMenus());
    draw();
    q.focus();
  }
  function openTranslate() {
    const m = menu();
    for (const lang of QUICK_LANGS) {
      const b = el("button", { class: "item", type: "button" }, `Translate into ${lang}`);
      b.addEventListener("click", () => {
        closeMenus();
        doTranslate(lang);
      });
      m.append(b);
    }
  }
  function draw() {
    if (!shadow) return;
    const row = shadow.querySelector(".row");
    row.textContent = "";
    const add = (label, title, fn, cls) => {
      const b = el("button", { type: "button", title, ...(cls ? { class: cls } : {}), dir: "auto" }, label);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
      row.append(b);
    };
    add("Continue", "Ask Claude to continue where it stopped", doContinue, "main");
    add("Regenerate", "Turn the prompt in the box into a request to rewrite it", doRegenerate);
    add("Translate ▾", "Translate the text in the box", openTranslate);
    add("Prompts ▾", "Insert a prompt from your Prompt Bank", () => openPrompts());
    for (const b of CCBLibrary.buttons(library)) add(b.label, describe(b), () => runButton(b));
    add("☆ Save", "Save the text in the box to your Prompt Bank", saveCurrent);
  }
  function describe(b) {
    const a = b.action || {};
    const text = typeof a.text === "string" ? a.text : promptBody(a.promptId) || "";
    return (a.type === "submit" ? "Send: " : "Insert: ") + text.slice(0, 120);
  }
  function mount() {
    const box = findComposer();
    if (!box) return;
    const frame = frameOf(box);
    if (!frame || !frame.parentElement) return;
    // A page that redraws by copying its HTML leaves empty copies of our row behind.
    document.querySelectorAll(`#${HOST_ID}`).forEach((n) => n !== host && n.remove());
    if (host && host.isConnected && host.nextElementSibling === frame) return;
    host?.remove();
    host = el("div", { id: HOST_ID });
    shadow = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = CSS;
    const wrap = el("div", { class: "wrap" });
    wrap.append(el("div", { class: "row", role: "toolbar", "aria-label": "Prompt buttons" }));
    shadow.append(style, wrap);
    frame.parentElement.insertBefore(host, frame);
    draw();
  }

  document.addEventListener("click", (e) => {
    if (host && !e.composedPath().includes(host)) closeMenus();
  });
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      mount();
    }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  CCBLibrary.load().then(({ library: l }) => {
    library = l;
    mount();
    draw();
  });
  CCBLibrary.onChange((l) => {
    library = l;
    draw();
  });
})();
