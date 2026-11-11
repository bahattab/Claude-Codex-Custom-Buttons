// State the prompt-buttons mod keeps for the session ($.state), and the shapes
// it reads from ccb-mcp's client_state tool.

export type FillMode = "replace" | "append" | "insert";

export type ButtonAction =
  | { type: "submit"; promptId: string }
  | { type: "submit"; text: string }
  | { type: "fill"; promptId: string; mode: FillMode }
  | { type: "fill"; text: string; mode: FillMode }
  | { type: "refine" }
  | { type: "continue" }
  | { type: "insert-prompt"; category: string | null; search: string | null }
  | { type: "open-pane"; pane: "notes" | "prompt-bank" };

export type ButtonView = {
  id: string;
  label: string;
  icon: string | null;
  action: ButtonAction;
  order: number;
  targetMissing: boolean;
};

export type ClientState = {
  buttons: ButtonView[];
  variables: Record<string, string>;
  settings: {
    regenerate: { autoSubmit: boolean; source: "auto" | "selection" | "draft" | "last" };
    continue: { highlightOnTruncation: boolean };
    buttons: { maxVisible: number; showBuiltIns: boolean };
    notes?: { autosaveMs: number };
    translate?: TranslateSettings;
  };
  continueMessage: string;
  regenerateInstructions: string | null;
  /** Google Drive sync, or null when the server runs without it. */
  sync?: SyncSummary | null;
};

export type SyncState = "off" | "not-set-up" | "signed-out" | "no-credential-store" | "idle" | "syncing" | "offline" | "error";

export type SyncSummary = {
  state: SyncState;
  /** "Sync ✓ 12:04", "Sync offline · 2 pending", "Sync ⚠ sign in" ... */
  line: string;
  pending: number;
  conflicts: number;
  message: string | null;
  /** Notes changed here and not uploaded yet, as "notes/<id>". */
  pendingKeys: string[];
};

/** A Google sign-in started from the Prompt Bank (sync_connect). */
export type ConnectView = { state: "waiting" | "done" | "failed"; url: string | null; message: string | null };

export type TranslateSettings = { target: string; primary: string; secondary: string; instant: boolean };

/** One translation shown in the pane, the bubble or the history. */
export type TranslationView = { source: string; text: string; from: string | null; to: string | null };

export type TranslateView = {
  /** The text in the pane's source box. */
  source: string;
  /** "auto" or a language name: what the pane translates into. */
  target: string;
  result: TranslationView | null;
  busy: boolean;
  error: string | null;
  /** Newest first, at most 20, for this session. */
  history: TranslationView[];
};

/** The instant-translation bubble above the prompt box. */
export type BubbleView = { state: "translating" | "done" | "failed"; source: string; result: TranslationView | null; error: string | null } | null;

/** What Undo puts back after a Regenerate. */
export type UndoState = { text: string; id: string };

/** What is in progress, and since when (ms). */
export type BusyState = { kind: string; since: number };

export type PromptSummary = {
  id: string;
  title: string;
  category: string | null;
  tags: string[];
  favorite: boolean;
  conflictOf: string | null;
  preview: string;
};

/** A prompt being written or edited in the Prompt Bank pane (kept if the pane closes). */
export type PromptDraft = {
  id: string | null;
  title: string;
  body: string;
  tags: string;
  category: string | null;
  favorite: boolean;
};

export type ButtonDraft = {
  id: string;
  label: string;
  icon: string;
  type: "submit" | "fill" | "continue" | "refine" | "open-notes" | "open-prompt-bank" | "insert-prompt";
  promptId: string;
  text: string;
  mode: FillMode;
  /** insert-prompt: the category to open on, or "" for all. */
  category: string;
};

export type BankView = {
  tab: "prompts" | "variables" | "buttons";
  query: string;
  category: string | null;
  favoritesOnly: boolean;
  editing: PromptDraft | null;
  confirmDelete: string | null;
  lastDeleted: { id: string; title: string; body: string; category: string | null; tags: string[]; favorite: boolean } | null;
  variableDraft: { name: string; value: string };
  buttonDraft: ButtonDraft | null;
  notice: string | null;
  /** Set while a Google sign-in started here is in progress or just finished. */
  connect: ConnectView | null;
};

export type BankData = {
  results: PromptSummary[];
  categories: Array<{ id: string; name: string; prompts: number }>;
  variables: Record<string, string>;
  buttons: ButtonView[];
  counts: { prompts: number; favorites: number; notes: number; conflicts: number } | null;
};

export type NoteSummary = { id: string; title: string; pinned: boolean; updatedAt: string; conflictOf: string | null; length: number };

export type NotesView = {
  list: NoteSummary[];
  selectedId: string | null;
  title: string;
  /** What the editor shows. */
  draft: string;
  /** The note's text as last loaded or saved: what `draft` was edited from. */
  base: string;
  dirty: boolean;
  /** Text saved elsewhere while this note had unsaved edits here. */
  theirs: string | null;
  renaming: string | null;
  confirmDelete: boolean;
  saveToken: number;
  /** Changes whenever the editor moves to another note or a new one, so a late save reply isn't applied to the wrong note. */
  editor: number;
  notice: string | null;
};

declare module "claude-code" {
  interface PluginState {
    "prompt-buttons": {
      client: ClientState | null;
      truncated: boolean;
      undo: UndoState | null;
      busy: BusyState | null;
      bankView: BankView;
      bankData: BankData;
      notesView: NotesView;
      translateView: TranslateView;
      bubble: BubbleView;
    };
  }
}
