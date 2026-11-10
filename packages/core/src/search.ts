// Prompt Bank search. Every word typed must appear somewhere (title, tags or body);
// matches in the title count most, then tags, then body. Favourites and recently or
// often used prompts rank higher. See docs/features.md#5-prompt-bank.
import type { Iso, Prompt } from "./types.js";

export interface SearchOptions {
  category?: string | null;
  tag?: string;
  favoritesOnly?: boolean;
  /** Include deleted prompts (for an "undo delete" view). Default false. */
  includeDeleted?: boolean;
  /** Used for the "recently used" boost. */
  now?: Iso;
  limit?: number;
}

export interface SearchHit {
  prompt: Prompt;
  score: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036F]/g, "").toLowerCase();
}

function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** Search prompts. An empty query lists prompts: favourites, then recently used, then by title. */
export function searchPrompts(prompts: readonly Prompt[], query: string, opts: SearchOptions = {}): SearchHit[] {
  const terms = words(query);
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  const hits: SearchHit[] = [];

  for (const prompt of prompts) {
    if (!opts.includeDeleted && prompt.deletedAt !== null) continue;
    if (opts.category !== undefined && prompt.category !== opts.category) continue;
    if (opts.tag !== undefined && !prompt.tags.includes(opts.tag.toLowerCase())) continue;
    if (opts.favoritesOnly && !prompt.favorite) continue;

    let score = 0;
    if (terms.length > 0) {
      const title = fold(prompt.title);
      const tags = prompt.tags.map(fold);
      const body = fold(prompt.body);
      let all = true;
      for (const term of terms) {
        let termScore = 0;
        if (title.includes(term)) termScore += title.startsWith(term) ? 12 : 10;
        if (tags.some((t) => t === term)) termScore += 6;
        else if (tags.some((t) => t.includes(term))) termScore += 4;
        if (body.includes(term)) termScore += 1;
        if (termScore === 0) {
          all = false;
          break;
        }
        score += termScore;
      }
      if (!all) continue;
    }
    if (prompt.favorite) score += 3;
    if (prompt.lastUsedAt !== null) {
      const days = (nowMs - Date.parse(prompt.lastUsedAt)) / DAY_MS;
      if (days <= 7) score += 2;
      else if (days <= 30) score += 1;
    }
    score += Math.min(2, Math.log10(1 + prompt.useCount));
    hits.push({ prompt, score });
  }

  hits.sort((a, b) => b.score - a.score || a.prompt.title.localeCompare(b.prompt.title));
  return opts.limit !== undefined ? hits.slice(0, opts.limit) : hits;
}
