import { atom } from 'jotai'
import type { Lang } from '../i18n'

export const themeAtom = atom<'light' | 'dark' | 'system'>('light')
export const langAtom = atom<Lang>('zh')
