// The toolbar popup: add and delete buttons, delete prompts, import and export.
/* global CCB, CCBLibrary */
(() => {
  const $ = (id) => document.getElementById(id);
  const say = (text) => ($("msg").textContent = text);
  const where = (w) => ($("where").textContent = w === "local" ? "Saved on this computer" : "Synced by Chrome");

  function row(label, onDelete) {
    const it = document.createElement("div");
    it.className = "item";
    const s = document.createElement("span");
    s.dir = "auto";
    s.textContent = label;
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      if (del.dataset.armed) return onDelete();
      del.dataset.armed = "1";
      del.textContent = "Confirm";
      setTimeout(() => {
        delete del.dataset.armed;
        del.textContent = "Delete";
      }, 3000);
    });
    it.append(s, del);
    return it;
  }
  function empty(text) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = text;
    return p;
  }

  async function render() {
    const { library, where: w } = await CCBLibrary.load();
    where(w);
    const bl = $("buttons");
    bl.textContent = "";
    const buttons = CCBLibrary.buttons(library);
    if (!buttons.length) bl.append(empty("No buttons of your own yet."));
    for (const b of buttons) bl.append(row(b.label, () => change((l, c) => CCB.deleteButton(l, b.id, c), "Button deleted.")));
    const pl = $("prompts");
    pl.textContent = "";
    const prompts = CCBLibrary.prompts(library);
    if (!prompts.length) pl.append(empty("No prompts yet."));
    for (const p of prompts) pl.append(row((p.favorite ? "★ " : "") + p.title, () => change((l, c) => CCB.deletePrompt(l, p.id, c), "Prompt deleted.")));
  }
  async function change(op, done) {
    const r = await CCBLibrary.edit(op);
    if (!r.ok) return say(r.errors.join("; "));
    where(r.where);
    say(done);
    render();
  }

  $("b-add").addEventListener("click", () => {
    const label = $("b-label").value.trim();
    const text = $("b-text").value.trim();
    if (!label || !text) return say("Give the button a name and a text.");
    const action = $("b-send").checked ? { type: "submit", text } : { type: "fill", text, mode: "replace" };
    change((l, c) => CCB.saveButton(l, { id: CCBLibrary.newButtonId(), label: label.slice(0, 24), action }, c), "Button added.").then(() => {
      $("b-label").value = "";
      $("b-text").value = "";
    });
  });

  $("export").addEventListener("click", async () => {
    const text = await CCBLibrary.exportText();
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "prompt-buttons.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say("Exported. Import it with `ccb import prompt-buttons.json` or in the Prompt Buttons page.");
  });
  $("import-btn").addEventListener("click", () => $("import").click());
  $("import").addEventListener("change", async () => {
    const f = $("import").files && $("import").files[0];
    if (!f) return;
    let raw;
    try {
      raw = JSON.parse(await f.text());
    } catch (_) {
      return say("That file isn't valid JSON.");
    }
    const r = await CCBLibrary.importDoc(raw);
    if (!r.ok) return say("Not imported: " + r.errors.slice(0, 2).join("; "));
    where(r.where);
    say(`Imported. You now have ${CCBLibrary.prompts(r.library).length} prompts and ${CCBLibrary.buttons(r.library).length} buttons.`);
    render();
  });

  render();
})();
