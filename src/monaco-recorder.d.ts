// Type declarations for monaco-recorder

export interface Position {
  lineNumber: number;
  column: number;
}

export interface Selection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface Range {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export type RecorderEvent =
  | ({ type: 'initialState'; content: string; position: Position | null; selection: Selection | null } & Timestamped)
  | ({ type: 'contentChange'; changes: { range: Range; text: string }[]; versionId: number; duringSuggest: boolean } & Timestamped)
  | ({ type: 'cursorPosition'; position: Position } & Timestamped)
  | ({ type: 'cursorSelection'; selection: Selection } & Timestamped)
  | ({ type: 'keyDown'; key: string; code?: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; category?: 'navigation' | string } & Timestamped)
  | ({ type: 'suggestShow'; method?: string; reason?: unknown } & Timestamped)
  | ({ type: 'suggestHide'; method?: string; reason?: unknown } & Timestamped)
  | ({ type: 'suggestFocus'; item?: { label?: string }; index?: number } & Timestamped);

export interface Timestamped { timestamp: number; }

export interface RecorderOptions {
  captureCursor?: boolean; // currently unused externally but kept for back-compat
  captureSelection?: boolean;
  captureKeys?: boolean;
  captureSuggest?: boolean;
}

export interface PlayOptions {
  speed?: number; // 100 = real-time baseline; higher is faster
  minDelayMs?: number;
  maxDelayMs?: number;
  onProgress?: (index: number, total: number, event: RecorderEvent) => void;
  onDone?: () => void;
}

export interface RecorderAPI {
  start(): () => RecorderEvent[]; // returns stop function that returns the captured events
  stop(): RecorderEvent[]; // stops and returns the captured events
  getEvents(): RecorderEvent[];
  play(recording?: RecorderEvent[], options?: PlayOptions): void;
  stopPlayback(): void;
}

export default function createMonacoRecorder(editor: any, monaco: any, options?: RecorderOptions): RecorderAPI;

export function createRecorder(editor: any, monaco: any, options?: RecorderOptions): {
  start: RecorderAPI['start'];
  stop: RecorderAPI['stop'];
  getEvents: RecorderAPI['getEvents'];
};

export function createPlayback(editor: any, monaco: any, options?: RecorderOptions): {
  play: RecorderAPI['play'];
  stopPlayback: RecorderAPI['stopPlayback'];
};

export function serializeEvents(events: RecorderEvent[] | unknown): string;
export function deserializeEvents(json: string): RecorderEvent[];
