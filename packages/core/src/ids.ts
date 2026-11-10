// IDs, slugs and content hashes. Pure functions: randomness and time are passed in.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** True for a 26-character ULID. */
export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 2 ** 48 - 1) {
    throw new RangeError(`ULID time out of range: ${ms}`);
  }
  let out = "";
  let rest = ms;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/**
 * A new ULID. `random` returns numbers in [0, 1); pass a cryptographically
 * strong source in production (e.g. based on crypto.getRandomValues).
 */
export function ulid(timeMs: number, random: () => number): string {
  let tail = "";
  for (let i = 0; i < 16; i++) tail += CROCKFORD[Math.floor(random() * 32) % 32];
  return encodeTime(timeMs) + tail;
}

/** A ULID whose random part is derived from `seed`, so every device computes the same one. */
export function deterministicUlid(timeMs: number, seed: string): string {
  const hex = hash(seed) + hash(`${seed}#2`);
  let tail = "";
  for (let i = 0; i < 16; i++) tail += CROCKFORD[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 32];
  return encodeTime(timeMs) + tail;
}

/** cyrb53: a fast, well-distributed 53-bit string hash. Not for security. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A 28-hex-character (106-bit) hash of a string, stable across platforms. */
export function hash(text: string): string {
  return (
    cyrb53(text, 0).toString(16).padStart(14, "0") + cyrb53(text, 0x9e3779b9).toString(16).padStart(14, "0")
  );
}

/** JSON with object keys sorted, so equal values always serialise the same way. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Lowercase, hyphen-separated, ASCII-letters-and-digits slug, at most 60 characters. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}
