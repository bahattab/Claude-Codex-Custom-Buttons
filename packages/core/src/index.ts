// Public API of @ccb/core. Pure TypeScript with no dependencies and no input/output, so it
// can be copied into the Claude mod (decision D13).

/** The data folder name under the user's home folder. */
export const DATA_DIR_NAME = ".claude-codex-buttons";

export * from "./types.js";
export {
  SCHEMA_VERSION,
  DEVICE_FILE_FORMAT,
  LIMITS,
  SHARED_SETTING_IDS,
  VARIABLE_NAME_RE,
  CATEGORY_ID_RE,
  BUTTON_ID_RE,
  DEVICE_ID_RE,
  cleanText,
  defaultSettings,
  deriveNoteTitle,
  emptyLibrary,
  isIso,
  newDeviceId,
  normalizeVariableName,
  validateDeviceFile,
  validateLibrary,
  validateRecord,
} from "./schema.js";
export { canonicalJson, deterministicUlid, hash, isUlid, slugify, ulid } from "./ids.js";
export { applyEdit, contentHash, deleteRecord, live, newMeta, recordUse, restoreRecord } from "./records.js";
export {
  BUILT_IN_VARIABLES,
  askFields,
  dateBuiltIns,
  expand,
  usedVariables,
  type AskField,
  type BuiltInVariable,
  type ExpandContext,
  type ExpandResult,
} from "./template.js";
export { searchPrompts, type SearchHit, type SearchOptions } from "./search.js";
export {
  DEFAULT_CONTINUE_MESSAGE,
  REFINE_INSTRUCTIONS,
  buildRefineRequest,
  cleanRefineOutput,
  missingFragments,
  protectedFragments,
  type RefineRequest,
} from "./refine.js";
export { MIGRATIONS, loadLibrary, type LoadResult } from "./migrate.js";
export { STARTER_CATEGORIES, STARTER_PROMPTS, STARTER_VARIABLES, seedStarterPack } from "./starter.js";
export {
  RETENTION_DAYS,
  emptyBase,
  merge,
  needsPush,
  sameData,
  toDeviceFile,
  type ConflictCopy,
  type MergeInput,
  type MergeResult,
  type SyncBase,
} from "./sync/merge.js";
