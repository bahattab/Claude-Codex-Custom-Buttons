// An in-memory Google Drive v3 answering the requests DriveRemote makes, with a change
// feed, access-token checks and switches for failures. Shapes follow the Drive v3 API.

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  createdTime: string;
  content: string;
}

interface Change {
  seq: number;
  fileId: string;
  removed: boolean;
}

export class FakeDrive {
  files = new Map<string, FakeFile>();
  changes: Change[] = [];
  validTokens = new Set<string>(["token-1"]);
  /** Throw a network error on every request. */
  offline = false;
  /** HTTP statuses to answer the next requests with, in order. */
  failNext: Array<{ status: number; body?: unknown }> = [];
  requests: Array<{ method: string; url: string }> = [];
  resumableUploads = 0;
  private sessions = new Map<string, { create?: Partial<FakeFile>; update?: string }>();
  private seq = 0;
  private ids = 0;
  private clock = Date.parse("2026-11-11T09:00:00.000Z");

  readonly fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    this.requests.push({ method, url });
    if (this.offline) throw new TypeError("fetch failed");
    const auth = (init.headers as Record<string, string> | undefined)?.["authorization"] ?? "";
    if (!this.validTokens.has(auth.replace(/^Bearer /, ""))) return json(401, { error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } });
    const fail = this.failNext.shift();
    if (fail) return json(fail.status, fail.body ?? { error: { code: fail.status, message: "fail" } });

    const u = new URL(url);
    const path = u.pathname;
    if (method === "GET" && path === "/drive/v3/changes/startPageToken") return json(200, { startPageToken: String(this.seq + 1) });
    if (method === "GET" && path === "/drive/v3/changes") return this.listChanges(u);
    if (method === "GET" && path === "/drive/v3/files") return this.list(u);
    if (method === "POST" && path === "/drive/v3/files") return this.create(JSON.parse(String(init.body)) as Partial<FakeFile>, "");
    if (method === "POST" && path === "/upload/drive/v3/files" && u.searchParams.get("uploadType") === "resumable") {
      const meta = JSON.parse(String(init.body)) as Partial<FakeFile>;
      return this.startSession({ create: meta });
    }
    if (method === "POST" && path === "/upload/drive/v3/files") return this.createMultipart(String(init.body), (init.headers as Record<string, string>)["content-type"] ?? "");
    const media = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (method === "PATCH" && media?.[1]) {
      // Like Drive, a trashed file can still be updated (it stays in the trash).
      const f = this.files.get(decodeURIComponent(media[1]));
      if (!f) return json(404, { error: { code: 404, message: "File not found" } });
      if (u.searchParams.get("uploadType") === "resumable") return this.startSession({ update: f.id });
      f.content = String(init.body);
      this.touch(f.id);
      return json(200, { id: f.id });
    }
    const session = /^\/upload\/session\/(\d+)$/.exec(path);
    if (method === "PUT" && session?.[1]) {
      const s = this.sessions.get(session[1]);
      if (!s) return json(404, { error: { code: 404, message: "No such upload" } });
      this.sessions.delete(session[1]);
      this.resumableUploads++;
      if (s.update) {
        const f = this.files.get(s.update);
        if (!f) return json(404, { error: { code: 404, message: "File not found" } });
        f.content = String(init.body);
        this.touch(f.id);
        return json(200, { id: f.id });
      }
      return this.create(s.create ?? {}, String(init.body));
    }
    const get = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (method === "GET" && get?.[1] && u.searchParams.get("alt") === "media") {
      const f = this.files.get(decodeURIComponent(get[1]));
      if (!f) return json(404, { error: { code: 404, message: "File not found" } });
      return new Response(f.content, { status: 200 });
    }
    return json(400, { error: { code: 400, message: `fake drive: unsupported ${method} ${path}` } });
  };

  /** Adds a file directly, as another app session or a test setup would. */
  add(meta: { name: string; mimeType?: string; parents?: string[]; content?: string }): string {
    const id = `f${++this.ids}`;
    this.files.set(id, {
      id,
      name: meta.name,
      mimeType: meta.mimeType ?? "application/json",
      parents: meta.parents ?? ["root"],
      trashed: false,
      createdTime: new Date((this.clock += 1000)).toISOString(),
      content: meta.content ?? "",
    });
    this.touch(id);
    return id;
  }

  /** Trashes a file; like Drive, trashing a folder trashes everything inside it. */
  trash(id: string): void {
    const f = this.files.get(id);
    if (!f) return;
    f.trashed = true;
    this.touch(id);
    for (const child of this.files.values()) if (child.parents.includes(id) && !child.trashed) this.trash(child.id);
  }

  folderNamed(name: string): FakeFile[] {
    return [...this.files.values()].filter((f) => f.name === name && f.mimeType === "application/vnd.google-apps.folder" && !f.trashed);
  }

  downloads(): number {
    return this.requests.filter((r) => r.url.includes("alt=media")).length;
  }

  private startSession(s: { create?: Partial<FakeFile>; update?: string }): Response {
    const id = String(++this.ids);
    this.sessions.set(id, s);
    return new Response("", { status: 200, headers: { location: `https://www.googleapis.com/upload/session/${id}` } });
  }

  private touch(fileId: string): void {
    this.changes.push({ seq: ++this.seq, fileId, removed: false });
  }

  private listChanges(u: URL): Response {
    const token = Number(u.searchParams.get("pageToken"));
    if (!Number.isFinite(token) || token < 1 || token > this.seq + 1) return json(400, { error: { code: 400, message: "Invalid pageToken" } });
    const size = Number(u.searchParams.get("pageSize") ?? 100);
    const page = this.changes.filter((c) => c.seq >= token).slice(0, size);
    const more = this.changes.some((c) => c.seq >= token + size);
    const changes = page.map((c) => {
      const f = this.files.get(c.fileId);
      return { fileId: c.fileId, removed: c.removed, ...(f ? { file: { id: f.id, name: f.name, parents: f.parents, trashed: f.trashed, mimeType: f.mimeType } } : {}) };
    });
    return json(200, more ? { nextPageToken: String(token + size), changes } : { newStartPageToken: String(this.seq + 1), changes });
  }

  private list(u: URL): Response {
    const q = u.searchParams.get("q") ?? "";
    const match = compile(q);
    const files = [...this.files.values()].filter(match).map(({ content: _c, ...f }) => f);
    return json(200, { files });
  }

  private create(meta: Partial<FakeFile>, content: string): Response {
    const id = this.add({ name: meta.name ?? "untitled", mimeType: meta.mimeType ?? "application/octet-stream", parents: meta.parents ?? ["root"], content });
    return json(200, { id });
  }

  private createMultipart(body: string, contentType: string): Response {
    const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
    if (!boundary) return json(400, { error: { code: 400, message: "no boundary" } });
    const parts = body.split(`--${boundary}`).slice(1, -1).map((p) => p.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""));
    const meta = JSON.parse(parts[0] ?? "{}") as Partial<FakeFile>;
    return this.create(meta, parts[1] ?? "");
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Evaluates the small subset of Drive's query language DriveRemote uses. */
function compile(q: string): (f: FakeFile) => boolean {
  const terms = splitTop(q, " and ");
  const tests = terms.map((t) => {
    const term = t.trim();
    if (term.startsWith("(") && term.endsWith(")")) {
      const alts = splitTop(term.slice(1, -1), " or ").map((a) => compile(a));
      return (f: FakeFile) => alts.some((a) => a(f));
    }
    let m = /^name = '((?:\\.|[^'])*)'$/.exec(term);
    if (m) return (f: FakeFile) => f.name === unquote(m?.[1] ?? "");
    m = /^mimeType (=|!=) '((?:\\.|[^'])*)'$/.exec(term);
    if (m) {
      const [, op, v] = m;
      return (f: FakeFile) => (op === "=" ? f.mimeType === v : f.mimeType !== v);
    }
    m = /^'((?:\\.|[^'])*)' in parents$/.exec(term);
    if (m) return (f: FakeFile) => f.parents.includes(unquote(m?.[1] ?? ""));
    if (term === "trashed = false") return (f: FakeFile) => !f.trashed;
    throw new Error(`fake drive: unsupported query term ${term}`);
  });
  return (f) => tests.every((t) => t(f));
}

function unquote(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(start));
  return out;
}
