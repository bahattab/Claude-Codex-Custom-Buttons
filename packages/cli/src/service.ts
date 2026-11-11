// The background sync service: `ccb sync --daemon`, started at log-in by the OS's own
// per-user service manager, with no administrator rights (decision D14).
//   Linux    a systemd --user service
//   macOS    a launchd agent in ~/Library/LaunchAgents
//   Windows  a value under HKCU\...\Run (no administrator rights), started hidden through
//            a small VBScript; stopped through the pid file the daemon writes
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "@ccb/store";
import type { CommandRunner } from "@ccb/sync";

export const SERVICE_NAME = "claude-codex-buttons-sync";
export const LAUNCHD_LABEL = "com.claude-codex-buttons.sync";
export const TASK_NAME = "ClaudeCodexButtonsSync";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** Where `ccb sync --daemon` records its process ID while it runs. */
export function pidFile(dataHome: string): string {
  return join(dataHome, "sync-daemon.pid");
}

export interface ServiceContext {
  platform: NodeJS.Platform;
  /** The user's home folder. */
  userHome: string;
  /** The data folder, passed to the daemon with --home. */
  dataHome: string;
  /** The Node.js binary and the ccb script to run. */
  node: string;
  script: string;
  /** The numeric user ID (launchd's gui/<uid> domain). */
  uid: number;
}

interface Step {
  cmd: string;
  args: string[];
  /** A failure of this step doesn't stop the plan (e.g. removing what isn't there). */
  optional?: boolean;
}

export interface ServicePlan {
  kind: "systemd" | "launchd" | "windows-run-key";
  /** Files written on install and removed on uninstall (utf16: UTF-16LE with a BOM, for Windows Script Host). */
  files: Array<{ path: string; content: string; utf16?: boolean }>;
  install: Step[];
  stop: Step[];
  uninstall: Step[];
  /** Exit code 0 means installed and running (or, for Task Scheduler, installed). */
  status: Step;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** systemd quoting: double quotes, backslashes and quotes escaped, % and $ doubled (specifiers and variables). */
function sdQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
}

export function servicePlan(c: ServiceContext): ServicePlan {
  const args = [c.script, "sync", "--daemon", "--home", c.dataHome];
  if (c.platform === "linux") {
    const path = join(c.userHome, ".config", "systemd", "user", `${SERVICE_NAME}.service`);
    const content = `[Unit]
Description=Claude Codex Buttons background sync (Google Drive)

[Service]
ExecStart=${[c.node, ...args].map(sdQuote).join(" ")}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;
    const sc = (...a: string[]): Step => ({ cmd: "systemctl", args: ["--user", ...a] });
    return {
      kind: "systemd",
      files: [{ path, content }],
      install: [sc("daemon-reload"), sc("enable", "--now", `${SERVICE_NAME}.service`)],
      stop: [sc("stop", `${SERVICE_NAME}.service`)],
      uninstall: [{ ...sc("disable", "--now", `${SERVICE_NAME}.service`), optional: true }, { ...sc("daemon-reload"), optional: true }],
      status: sc("is-active", "--quiet", `${SERVICE_NAME}.service`),
    };
  }
  if (c.platform === "darwin") {
    const path = join(c.userHome, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[c.node, ...args].map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardErrorPath</key><string>${xmlEscape(join(c.dataHome, "sync-service.log"))}</string>
</dict>
</plist>
`;
    const domain = `gui/${c.uid}`;
    return {
      kind: "launchd",
      files: [{ path, content }],
      install: [{ cmd: "launchctl", args: ["bootout", `${domain}/${LAUNCHD_LABEL}`], optional: true }, { cmd: "launchctl", args: ["bootstrap", domain, path] }],
      stop: [{ cmd: "launchctl", args: ["bootout", `${domain}/${LAUNCHD_LABEL}`] }],
      uninstall: [{ cmd: "launchctl", args: ["bootout", `${domain}/${LAUNCHD_LABEL}`], optional: true }],
      status: { cmd: "launchctl", args: ["print", `${domain}/${LAUNCHD_LABEL}`] },
    };
  }
  if (c.platform === "win32") {
    const path = join(c.dataHome, "sync-service.vbs");
    // Inside a VBScript string a quote is written twice, so each argument becomes ""arg"".
    // Windows paths can't contain quotes, so nothing else needs escaping.
    const line = [c.node, ...args].map((a) => `""${a}""`).join(" ");
    const content = `' Starts Claude Codex Buttons background sync without a console window.\r\nCreateObject("WScript.Shell").Run "${line}", 0, False\r\n`;
    const launch = ["//B", "//NoLogo", path];
    return {
      kind: "windows-run-key",
      files: [{ path, content, utf16: true }],
      install: [
        { cmd: "reg", args: ["add", RUN_KEY, "/v", TASK_NAME, "/t", "REG_SZ", "/d", `wscript.exe //B //NoLogo "${path}"`, "/f"] },
        { cmd: "wscript.exe", args: launch },
      ],
      stop: [],
      uninstall: [{ cmd: "reg", args: ["delete", RUN_KEY, "/v", TASK_NAME, "/f"], optional: true }],
      status: { cmd: "reg", args: ["query", RUN_KEY, "/v", TASK_NAME] },
    };
  }
  throw new Error(`The background sync service isn't supported on ${c.platform}. Sync still runs while Claude Code or Codex is open.`);
}

async function runSteps(steps: Step[], run: CommandRunner): Promise<void> {
  for (const step of steps) {
    let result;
    try {
      result = await run(step.cmd, step.args);
    } catch (error) {
      if (step.optional) continue;
      throw new Error(`${step.cmd} is not available (${(error as Error).message}).`, { cause: error });
    }
    if (result.code !== 0 && !step.optional) {
      throw new Error(`${step.cmd} ${step.args.join(" ")} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
    }
  }
}

/** The running daemon's process ID, or null when none is running. */
export async function runningDaemon(dataHome: string): Promise<number | null> {
  const text = await readFile(pidFile(dataHome), "utf8").catch(() => "");
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM" ? pid : null;
  }
}

/** Ends the daemon this computer runs (Windows has no service manager to ask). */
async function killDaemon(c: ServiceContext, run: CommandRunner): Promise<void> {
  const pid = await runningDaemon(c.dataHome);
  if (pid === null) return;
  if (c.platform === "win32") await runSteps([{ cmd: "taskkill", args: ["/PID", String(pid), "/F"], optional: true }], run);
  else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  await rm(pidFile(c.dataHome), { force: true });
}

export async function installService(c: ServiceContext, run: CommandRunner): Promise<ServicePlan> {
  const plan = servicePlan(c);
  for (const f of plan.files) {
    await mkdir(dirname(f.path), { recursive: true });
    if (f.utf16) await writeFile(f.path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(f.content, "utf16le")]));
    else await writeFileAtomic(f.path, f.content, 0o644);
  }
  if (plan.kind === "windows-run-key") await killDaemon(c, run); // a reinstall replaces the running one
  await runSteps(plan.install, run);
  return plan;
}

export async function stopService(c: ServiceContext, run: CommandRunner): Promise<void> {
  const plan = servicePlan(c);
  await runSteps(plan.stop, run);
  if (plan.kind === "windows-run-key") await killDaemon(c, run);
}

export async function uninstallService(c: ServiceContext, run: CommandRunner): Promise<void> {
  const plan = servicePlan(c);
  await runSteps(plan.uninstall, run);
  if (plan.kind === "windows-run-key") await killDaemon(c, run);
  for (const f of plan.files) await rm(f.path, { force: true });
  if (plan.kind === "systemd") await runSteps([{ cmd: "systemctl", args: ["--user", "daemon-reload"], optional: true }], run);
}

export async function serviceStatus(c: ServiceContext, run: CommandRunner): Promise<"running" | "installed" | "not-installed" | "unsupported"> {
  let plan: ServicePlan;
  try {
    plan = servicePlan(c);
  } catch {
    return "unsupported";
  }
  if (plan.kind === "windows-run-key") {
    if ((await runningDaemon(c.dataHome)) !== null) return "running";
    const r = await run(plan.status.cmd, plan.status.args).catch(() => null);
    return r?.code === 0 ? "installed" : "not-installed";
  }
  try {
    const r = await run(plan.status.cmd, plan.status.args);
    if (r.code === 0) return "running";
  } catch {
    return "not-installed";
  }
  const { stat } = await import("node:fs/promises");
  const present = await Promise.all(plan.files.map((f) => stat(f.path).then(() => true, () => false)));
  return present.every(Boolean) ? "installed" : "not-installed";
}
