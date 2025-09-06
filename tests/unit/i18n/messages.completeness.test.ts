import { describe, it, expect } from 'vitest'
import en from '../../../src/messages/en.json'
import de from '../../../src/messages/de.json'

type Dict = Record<string, any>

function flattenKeys(obj: Dict, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenKeys(v as Dict, key))
    } else if (typeof v === 'string') {
      out[key] = v
    }
  }
  return out
}

function extractPlaceholders(s: string): Set<string> {
  // ICU-aware extraction: for each top-level {...} placeholder,
  // capture only the argument name (token before the first comma),
  // and ignore inner branch content like {one} / {ein} within plural/select.
  const out = new Set<string>()
  const isIdent = (t: string) => /^[A-Za-z0-9_]+$/.test(t)

  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue
    let depth = 0
    let name: string | null = null
    let token: string[] = []

    // consume the placeholder
    for (; i < s.length; i++) {
      const ch = s[i]
      if (ch === '{') {
        depth++
        // skip the opening brace itself
        if (depth === 1) continue
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          // closing of the top-level placeholder
          const finalName = (name ?? token.join('')).trim()
          if (finalName && finalName !== '#' && isIdent(finalName)) out.add(finalName)
          break
        }
      }

      // collect only at depth 1 (top-level content of the placeholder)
      if (depth === 1) {
        if (ch === ',') {
          // name token ends at first comma
          if (name === null) name = token.join('').trim()
        } else if (name === null) {
          token.push(ch)
        }
      }
    }
  }
  return out
}

describe('i18n completeness', () => {
  const enFlat = flattenKeys(en as Dict)
  const deFlat = flattenKeys(de as Dict)

  it('DE has all EN keys and no extra keys', () => {
    const enKeys = new Set(Object.keys(enFlat))
    const deKeys = new Set(Object.keys(deFlat))

    const missingInDe: string[] = []
    for (const k of enKeys) if (!deKeys.has(k)) missingInDe.push(k)

    const extraInDe: string[] = []
    for (const k of deKeys) if (!enKeys.has(k)) extraInDe.push(k)

    expect({ missingInDe, extraInDe }).toEqual({ missingInDe: [], extraInDe: [] })
  })

  it('placeholders are consistent between EN and DE', () => {
    const commonKeys = Object.keys(enFlat).filter((k) => k in deFlat)
    const mismatches: Array<{ key: string; en: string[]; de: string[] }> = []
    for (const k of commonKeys) {
      const enPh = Array.from(extractPlaceholders(enFlat[k])).sort()
      const dePh = Array.from(extractPlaceholders(deFlat[k])).sort()
      if (enPh.join('|') !== dePh.join('|')) {
        mismatches.push({ key: k, en: enPh, de: dePh })
      }
    }
    expect(mismatches).toEqual([])
  })
})
