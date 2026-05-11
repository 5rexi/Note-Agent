import { useAtomValue } from 'jotai'
import { langAtom } from '../atoms'
import { translations, type TranslationKey } from '../i18n'

export function useT() {
  const lang = useAtomValue(langAtom)

  const t = (key: TranslationKey, vars?: Record<string, string>) => {
    const dict = translations[lang] as Record<string, string>
    const fallback = translations.zh as Record<string, string>
    let text = dict[key] ?? fallback[key] ?? key
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
      })
    }
    return text
  }

  return { t, lang }
}
