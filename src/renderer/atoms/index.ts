/**
 * Re-exports all atoms from their domain modules.
 *
 * Existing callers `import { ... } from '../atoms'` continue to work; new
 * code should prefer importing from the specific domain file when only
 * one slice is needed (faster IDE navigation and clearer reviews).
 */
export * from './workspace'
export * from './task'
export * from './session'
export * from './chat'
export * from './editor'
export * from './ui'
