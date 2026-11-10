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
  };
  continueMessage: string;
  regenerateInstructions: string | null;
};

/** What Undo puts back after a Regenerate. */
export type UndoState = { text: string; id: string };

/** What is in progress, and since when (ms). */
export type BusyState = { kind: string; since: number };

declare module "claude-code" {
  interface PluginState {
    "prompt-buttons": {
      client: ClientState | null;
      truncated: boolean;
      undo: UndoState | null;
      busy: BusyState | null;
    };
  }
}
