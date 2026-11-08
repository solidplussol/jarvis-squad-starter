// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Jarvis Squad Starter project-only isolation (new file; see MODIFICATIONS).
//
// Optional recorded-usage panel. Renders NOTHING unless GET /api/usage says enabled.
// One same-origin GET on mount and on manual Refresh; plain React text only; no
// money, no live status. GitHub spend/remaining are always shown as Unknown.

import { useCallback, useEffect, useState } from 'react'
import { FONT, THEME, relTime, smallCaps } from './KanbanPanel'

interface Totals {
  events: number
  runs: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  request_multiplier_sum: number
}
interface Bucket extends Totals {
  label: string
  kind: string
}
interface Period {
  totals: Totals
  buckets: Bucket[]
}
type UsageResponse =
  | { enabled: false }
  | { enabled: true; available: false; reason: string }
  | {
      enabled: true
      available: true
      generatedAt: string
      ageSeconds: number
      stale: boolean
      attribution: string
      periods: Record<'last_24h' | 'last_7d' | 'all_time', Period>
      notes: string[]
    }

const PERIODS: { key: 'last_24h' | 'last_7d' | 'all_time'; label: string }[] = [
  { key: 'last_24h', label: 'Last 24 hours' },
  { key: 'last_7d', label: 'Last 7 days' },
  { key: 'all_time', label: 'All time' },
]

const ATTRIBUTION_TEXT: Record<string, string> = {
  partial: 'partial: subagent runs are not attributed to named specialists',
  none: 'none: usage is not attributed to named specialists',
  proven: 'proven: attribution established from recorded data',
}

const fmt = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '?')
const fmtMult = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '?')

function tokenLine(t: Totals) {
  return `input ${fmt(t.input_tokens)} · output ${fmt(t.output_tokens)} · cache read ${fmt(t.cache_read_tokens)} · cache write ${fmt(t.cache_write_tokens)} · reasoning ${fmt(t.reasoning_tokens)}`
}

function PeriodBlock({ label, period }: { label: string; period: Period }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...smallCaps, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 11, marginTop: 4 }}>
        Total: {fmt(period.totals.events)} events · {tokenLine(period.totals)} · premium-request multiplier {fmtMult(period.totals.request_multiplier_sum)}
      </div>
      <ul style={{ margin: '4px 0 0', padding: '0 0 0 16px', fontSize: 11, opacity: 0.9 }}>
        {period.buckets.map((b, i) => (
          <li key={i} style={{ marginTop: 2 }}>
            {b.label}: {fmt(b.runs)} runs · {fmt(b.events)} events · {tokenLine(b)} · multiplier {fmtMult(b.request_multiplier_sum)}
          </li>
        ))}
        {period.buckets.length === 0 && <li>No recorded usage in this period.</li>}
      </ul>
    </div>
  )
}

export function UsagePanel() {
  const [data, setData] = useState<UsageResponse | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/usage', { method: 'GET', headers: { Accept: 'application/json' } })
      if (!r.ok) throw new Error('bad status')
      setData((await r.json()) as UsageResponse)
    } catch {
      setData({ enabled: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!data || data.enabled !== true) return null

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ position: 'fixed', bottom: 16, right: 244, zIndex: 300, padding: '6px 12px', background: 'rgba(0,20,30,0.85)', color: '#7fdcff', border: '1px solid #1d5f7a', borderRadius: 4, cursor: 'pointer', fontFamily: FONT, fontSize: 12, letterSpacing: 1 }}
      >
        {open ? 'CLOSE USAGE' : 'USAGE'}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Recorded usage (read-only)"
          style={{ position: 'fixed', top: 60, bottom: 56, left: '50%', transform: 'translateX(-50%)', width: 'min(900px, 96vw)', zIndex: 299, overflow: 'auto', padding: 16, background: 'radial-gradient(ellipse at top, rgba(18,28,64,0.97), rgba(6,8,20,0.98))', border: '1px solid rgba(127,220,255,0.35)', borderRadius: 12, color: THEME.text, fontFamily: FONT }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ ...smallCaps, fontSize: 15 }}>Usage - recorded, not live</div>
            <button
              onClick={() => void load()}
              disabled={loading}
              style={{ background: 'transparent', color: THEME.accent, border: `1px solid ${THEME.border}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 11 }}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11 }}>Recorded usage - not live. No dollar amounts are shown.</div>
          {data.available === false ? (
            <div style={{ marginTop: 10, padding: 8, border: '1px solid #7a5f1d', fontSize: 11 }}>{data.reason}</div>
          ) : (
            <>
              <div style={{ marginTop: 8, fontSize: 11 }}>
                Generated {data.generatedAt} ({relTime(data.generatedAt)}, {fmt(data.ageSeconds)} s ago){data.stale ? ' - STALE (older than 24 hours); re-run the collector script.' : ''}
              </div>
              <div style={{ marginTop: 4, fontSize: 11 }}>Attribution: {ATTRIBUTION_TEXT[data.attribution] ?? data.attribution}</div>
              <div style={{ marginTop: 4, fontSize: 11 }}>GitHub spend/remaining: Unknown (not configured)</div>
              {PERIODS.map((p) => (
                <PeriodBlock key={p.key} label={p.label} period={data.periods[p.key]} />
              ))}
              {data.notes.length > 0 && (
                <ul style={{ margin: '12px 0 0', padding: '0 0 0 16px', fontSize: 10, opacity: 0.7 }}>
                  {data.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
