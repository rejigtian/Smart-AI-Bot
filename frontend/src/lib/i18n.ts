import { useQuery } from '@tanstack/react-query'
import { fetchSettings } from './api'

export type Lang = 'zh' | 'en'

/** Current UI language, from the global settings (default zh). Reactive: changing
 *  the language in Settings invalidates ['settings'] → all components re-render. */
export function useLang(): Lang {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings, staleTime: 30_000 })
  return data?.language === 'en' ? 'en' : 'zh'
}

/**
 * Translation helper. Usage:
 *   const t = useT()
 *   <h1>{t('设置', 'Settings')}</h1>
 * Chinese stays the default (first arg), English is the second. No key files.
 */
export function useT() {
  const lang = useLang()
  return (zh: string, en: string) => (lang === 'en' ? en : zh)
}
