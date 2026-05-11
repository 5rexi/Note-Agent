// Shared between main and renderer — must be plain TS, no Node/React deps

export type LlmEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call-start'; toolCallId: string; toolName: string; args: Record<string, any> }
  | { type: 'tool-call-end'; toolCallId: string }
  | { type: 'tool-result'; toolCallId: string; result: any }
  | { type: 'done' }
  | { type: 'error'; message: string }
