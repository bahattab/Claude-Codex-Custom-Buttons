import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "@ccb/cli";
import type { CommandRunner } from "@ccb/sync";

import { servicePlan } from "../src/service.js";

let userHome: string;
let dataHome: string;
beforeEach(async () => {
  userHome = await mkdtemp(join(tmpdir(), "ccb-user-"));
  dataHome = await mkdtemp(join(tmpdir(), "ccb-data-"));
});
afterEach(async () => {
  await rm(userHome, { recursive: true, force: true });
  await rm(dataHome, { recursive: true, force: true });
});

function recorder(answer: (cmd: string, args: string[]) => { code: number; stdout?: string } = () => ({ code: 0 })) {
  const calls: string[] = [];
  const runner: CommandRunner = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    const a = answer(cmd, args);
    return { code: a.code, stdout: a.stdout ?? "", stderr: "" };
  };
  return { runner, calls };
}

const ctx = (platform: NodeJS.Platform) => ({ platform, userHome: "/home/u", dataHome: "/home/u/.claude-codex-buttons", node: "/usr/bin/node", script: "/opt/ccb/bin.js", uid: 501 });

async function ccb(args: string[], extra: object = {}): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { env: { CCB_HOME: dataHome }, out: (t) => out.push(t), err: (t) => err.push(t), ...extra });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("service plans", () => {
  it("Linux: a systemd user unit that runs ccb sync --daemon with the data folder", () => {
    const plan = servicePlan(ctx("linux"));
    expect(plan.files[0]?.path).toBe("/home/u/.config/systemd/user/claude-codex-buttons-sync.service");
    expect(plan.files[0]?.content).toContain('ExecStart="/usr/bin/node" "/opt/ccb/bin.js" "sync" "--daemon" "--home" "/home/u/.claude-codex-buttons"');
    expect(plan.files[0]?.content).toContain("WantedBy=default.target");
    expect(plan.install.map((s) => [s.cmd, ...s.args].join(" "))).toEqual(["systemctl --user daemon-reload", "systemctl --user enable --now claude-codex-buttons-sync.service"]);
  });

  it("macOS: a launchd agent in ~/Library/LaunchAgents, bootstrapped in the gui domain", () => {
    const plan = servicePlan({ ...ctx("darwin"), dataHome: "/Users/u/Data & <x>" });
    expect(plan.files[0]?.path).toBe("/home/u/Library/LaunchAgents/com.claude-codex-buttons.sync.plist");
    expect(plan.files[0]?.content).toContain("<string>--daemon</string>");
    expect(plan.files[0]?.content).toContain("<string>/Users/u/Data &amp; &lt;x&gt;</string>");
    expect(plan.install.at(-1)?.args).toEqual(["bootstrap", "gui/501", "/home/u/Library/LaunchAgents/com.claude-codex-buttons.sync.plist"]);
  });

  it("Windows: a per-user Run value that starts the daemon hidden through VBScript, no admin rights", () => {
    const plan = servicePlan({ ...ctx("win32"), node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\ccb\\bin.js", dataHome: "C:\\Users\\José\\.claude-codex-buttons" });
    expect(plan.files[0]?.utf16).toBe(true);
    expect(plan.files[0]?.content).toContain('Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\ccb\\bin.js"" ""sync"" ""--daemon"" ""--home"" ""C:\\Users\\José\\.claude-codex-buttons""", 0, False');
    const add = plan.install[0]?.args ?? [];
    expect(add.slice(0, 2)).toEqual(["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"]);
    expect(add).toContain("ClaudeCodexButtonsSync");
    expect(plan.install[1]?.cmd).toBe("wscript.exe");
  });

  it("systemd: % and $ in paths are escaped", () => {
    const plan = servicePlan({ ...ctx("linux"), dataHome: "/home/u/100% $HOME" });
    expect(plan.files[0]?.content).toContain('"/home/u/100%% $$HOME"');
  });

  it("other systems explain that sync still runs inside Claude Code and Codex", () => {
    expect(() => servicePlan(ctx("freebsd"))).toThrow(/still runs while Claude Code or Codex/);
  });
});

describe("ccb service", () => {
  it("install writes the unit, enables it and records the setting; status, stop and uninstall", async () => {
    const r = recorder();
    const service = { platform: "linux" as const, userHome, node: "/usr/bin/node", script: "/opt/ccb/bin.js", uid: 1000, run: r.runner };
    const install = await ccb(["service", "install"], { service });
    expect(install.code).toBe(0);
    const unit = join(userHome, ".config/systemd/user/claude-codex-buttons-sync.service");
    expect(await readFile(unit, "utf8")).toContain(`"--home" "${dataHome}"`);
    expect(r.calls).toContain("systemctl --user enable --now claude-codex-buttons-sync.service");
    expect((await ccb(["config", "get", "sync.backgroundService"])).out).toBe("true");
    expect((await ccb(["service", "status"], { service })).out).toMatch(/running/);
    expect((await ccb(["service", "stop"], { service })).code).toBe(0);
    expect((await ccb(["service", "uninstall"], { service })).code).toBe(0);
    await expect(stat(unit)).rejects.toThrow();
    expect((await ccb(["config", "get", "sync.backgroundService"])).out).toBe("false");
    expect((await ccb(["service", "bogus"], { service })).code).toBe(2);
  });

  it("status reports installed-but-stopped and not installed", async () => {
    const stopped = recorder(() => ({ code: 3 }));
    const service = { platform: "linux" as const, userHome, run: stopped.runner };
    expect((await ccb(["service", "status"], { service })).out).toMatch(/not-installed/);
    await ccb(["service", "install"], { service: { ...service, run: recorder().runner } });
    expect((await ccb(["service", "status"], { service })).out).toMatch(/installed/);
    const missing: CommandRunner = async () => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect((await ccb(["service", "status"], { service: { ...service, run: missing } })).out).toMatch(/not-installed/);
    expect((await ccb(["service", "status"], { service: { platform: "aix" as const } })).out).toMatch(/unsupported/);
  });

  it("a failing service manager is reported", async () => {
    const failing = recorder((cmd, args) => (args.includes("enable") ? { code: 1, stdout: "Failed to connect to bus" } : { code: 0 }));
    const res = await ccb(["service", "install"], { service: { platform: "linux" as const, userHome, run: failing.runner } });
    expect(res.code).toBe(1);
    expect(res.err).toMatch(/Failed to connect to bus/);
  });
});

describe("ccb sync --daemon", () => {
  it("syncs at start and keeps running until stopped", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ccb-daemon-folder-"));
    try {
      await ccb(["config", "set", "sync.mode", "drive-folder"]);
      await ccb(["config", "set", "sync.folderPath", folder]);
      let stop: () => void = () => undefined;
      const until = new Promise<void>((r) => (stop = r));
      const running = ccb(["sync", "--daemon"], { daemonUntil: until });
      for (let i = 0; i < 100; i++) {
        const files = await import("node:fs/promises").then((fs) => fs.readdir(join(folder, "devices")).catch(() => [] as string[]));
        if (files.length) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      stop();
      const res = await running;
      expect(res.code).toBe(0);
      expect(res.err).toMatch(/Sync/);
      const devices = await import("node:fs/promises").then((fs) => fs.readdir(join(folder, "devices")));
      expect(devices).toHaveLength(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("--home chooses the data folder", async () => {
    const other = await mkdtemp(join(tmpdir(), "ccb-home-flag-"));
    try {
      await ccb(["--home", other, "config", "set", "sync.mode", "off"]);
      expect((await ccb(["--home", other, "config", "get", "sync.mode"])).out).toBe('"off"');
      expect((await ccb(["config", "get", "sync.mode"])).out).toBe('"drive-api"');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

describe("login offers the background service", () => {
  it("asks, installs on yes, records no on no, and only hints when not interactive", async () => {
    const { FakeDrive } = await import("../../sync/test/fake-drive.js");
    const { TOKEN_URL } = await import("@ccb/sync");
    const drive = new FakeDrive();
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> =>
      url === TOKEN_URL ? Response.json({ access_token: "token-1", refresh_token: "1//refresh_tok", expires_in: 3600 }) : drive.fetch(url, init);
    const browser = async (href: string): Promise<void> => {
      const a = new URL(href);
      await fetch(`${a.searchParams.get("redirect_uri")}/?code=c&state=${a.searchParams.get("state")}`);
    };
    const clientFile = join(dataHome, "client.json");
    await writeFile(clientFile, JSON.stringify({ installed: { client_id: "id", client_secret: "s" } }));
    await ccb(["config", "set", "google.tokenStore", "file"]);
    const r = recorder();
    const common = { sync: { fetch: fetchImpl, openBrowser: browser }, service: { platform: "linux" as const, userHome, run: r.runner } };

    const hinted = await ccb(["login", "--client", clientFile], common);
    expect(hinted.out).toMatch(/run: ccb service install/);
    expect(r.calls).toHaveLength(0);

    const yes = await ccb(["login", "--client", clientFile], { ...common, ask: async () => "" });
    expect(yes.out).toMatch(/Background sync installed \(systemd\)/);
    expect(r.calls.some((c) => c.includes("enable --now"))).toBe(true);

    const no = await ccb(["login", "--client", clientFile], { ...common, ask: async () => "n" });
    expect(no.out).toMatch(/No background service/);
    expect((await ccb(["config", "get", "sync.backgroundService"])).out).toBe("false");
    const quiet = await ccb(["login", "--client", clientFile], { ...common, ask: async () => "y" });
    expect(quiet.out).not.toMatch(/Background sync installed/); // declined before: not asked again
    const flagged = await ccb(["login", "--client", clientFile, "--service"], common);
    expect(flagged.out).toMatch(/Background sync installed/);
  });
});

describe("service on macOS and Windows (commands only)", () => {
  it("installs, reports and removes the launchd agent", async () => {
    const r = recorder((cmd, args) => (args[0] === "print" ? { code: 0 } : { code: 0 }));
    const service = { platform: "darwin" as const, userHome, uid: 501, run: r.runner };
    expect((await ccb(["service", "install"], { service })).out).toMatch(/launchd/);
    expect(r.calls.some((c) => c.startsWith("launchctl bootstrap gui/501 "))).toBe(true);
    expect((await ccb(["service", "status"], { service })).out).toMatch(/running/);
    await ccb(["service", "stop"], { service });
    await ccb(["service", "uninstall"], { service });
    expect(r.calls.filter((c) => c.startsWith("launchctl bootout"))).not.toHaveLength(0);
  });

  it("Windows: installs the Run value and VBScript (UTF-16), status from the daemon's pid file, stop ends it", async () => {
    const r = recorder((cmd, args) => (cmd === "reg" && args[0] === "query" ? { code: 0 } : { code: 0 }));
    const service = { platform: "win32" as const, userHome, run: r.runner };
    expect((await ccb(["service", "install"], { service })).out).toMatch(/windows-run-key/);
    const vbs = await readFile(join(dataHome, "sync-service.vbs"));
    expect([vbs[0], vbs[1]]).toEqual([0xff, 0xfe]);
    expect(r.calls.some((c) => c.startsWith("reg add HKCU"))).toBe(true);
    expect((await ccb(["service", "status"], { service })).out).toMatch(/: installed/);
    // A running daemon (this test process stands in for it).
    await writeFile(join(dataHome, "sync-daemon.pid"), `${process.pid}\n`);
    expect((await ccb(["service", "status"], { service })).out).toMatch(/running/);
    await ccb(["service", "stop"], { service });
    expect(r.calls).toContain(`taskkill /PID ${process.pid} /F`);
    await ccb(["service", "uninstall"], { service });
    expect(r.calls.some((c) => c.startsWith("reg delete HKCU"))).toBe(true);
  });

  it("a missing service manager is explained", async () => {
    const missing: CommandRunner = async () => Promise.reject(Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }));
    const res = await ccb(["service", "install"], { service: { platform: "linux" as const, userHome, run: missing } });
    expect(res.code).toBe(1);
    expect(res.err).toMatch(/systemctl is not available/);
  });
});
