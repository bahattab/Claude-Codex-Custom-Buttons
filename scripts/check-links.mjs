// Checks that every relative Markdown link and #anchor in the repository resolves.
// External (http/https/mailto) links are not checked.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const root = process.cwd();
const skip = new Set(["node_modules", ".git", "dist", "coverage"]);

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

// GitHub's heading-to-anchor rule: lowercase, drop punctuation, spaces to hyphens.
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\- _]/gu, "")
    .replace(/ /g, "-");
}

function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}

const files = markdownFiles(root);
const anchors = new Map(
  files.map((file) => {
    const headings = [...stripCode(readFileSync(file, "utf8")).matchAll(/^#+\s+(.*)$/gm)];
    return [normalize(file), new Set(headings.map((m) => slug(m[1])))];
  }),
);

const problems = [];
for (const file of files) {
  const text = stripCode(readFileSync(file, "utf8"));
  for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [path, anchor] = link.split("#");
    const target = path ? normalize(join(dirname(file), path)) : normalize(file);
    const where = relative(root, file);
    if (!existsSync(target)) {
      problems.push(`${where}: missing target ${link}`);
    } else if (anchor && target.endsWith(".md") && !anchors.get(target)?.has(anchor)) {
      problems.push(`${where}: missing anchor ${link}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} broken link(s) in ${files.length} Markdown files.`);
  process.exit(1);
}
console.log(`All links resolve in ${files.length} Markdown files.`);
