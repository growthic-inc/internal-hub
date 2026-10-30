// Growthic One — delivery-calendar: pure Master Sheet parsing (no network, no Deno APIs).
//
// This is Growthic One's own implementation of the rules the Delivery Dashboard applies to the
// content writers' Master Sheet. The Delivery Dashboard (sheets.js) was the reference; nothing
// is shared with it at run time. Kept free of I/O so it can be unit-tested (parse.test.ts).

export const STATUSES = [
  'Ideation', 'Ideation Approved', 'Content Review', 'Content Approved',
  'Delivered', 'Client Approved', 'Posted', 'Rework', 'Rejected',
]

// color = CSS class suffix used by the Calendar; abbr = text shown in the day cell.
export const STATUS_META: Record<string, { color: string; abbr: string }> = {
  'Ideation':          { color: 'ideation',          abbr: 'ID'  },
  'Ideation Approved': { color: 'ideation-approved', abbr: 'IA'  },
  'Content Review':    { color: 'content-review',    abbr: 'CR'  },
  'Content Approved':  { color: 'content-approved',  abbr: 'CA'  },
  'Delivered':         { color: 'delivered',         abbr: 'DL'  },
  'Client Approved':   { color: 'client-approved',   abbr: 'CLA' },
  'Posted':            { color: 'green',             abbr: 'PO'  },
  'Rework':            { color: 'orange',            abbr: 'RW'  },
  'Rejected':          { color: 'red',               abbr: 'RJ'  },
}
const UNKNOWN_STATUS_META = { color: 'grey', abbr: '?' }

// Reference / legend tabs that are never a client.
export const NON_CLIENT_TABS = new Set(['monthly targets', 'statuses', 'status', 'legend', 'readme', 'read me'])

export type Cell = string | number | boolean | null | undefined
export type Row = Cell[]

export interface Deliverable {
  date: string            // YYYY-MM-DD (undated rows are dropped)
  status: string | null
  statusColor: string
  statusAbbr: string
  statusUnrecognized: boolean
  bucket: string
  content: string
  tagline: string
  creativeLink: string
}

export interface ParsedTab {
  deliverables: Deliverable[]
  looksLikeClient: boolean
}

// Google Sheets date epoch is 1899-12-30.
export function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000))
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

// Free-text dates: "22nd June", "22 June 2026", "22/06/2026", "June 22". Day-first (Indian) convention.
export function parseTextDate(raw: Cell, referenceYear: number): Date | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  s = s.replace(/(\d+)(st|nd|rd|th)/gi, '$1')

  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (m) {
    const day = parseInt(m[1], 10), month = parseInt(m[2], 10) - 1
    let year = parseInt(m[3], 10)
    if (year < 100) year += 2000
    const d = new Date(Date.UTC(year, month, day))
    if (!isNaN(d.getTime()) && d.getUTCMonth() === month) return d
  }

  m = s.match(/^(\d{1,2})\s+([a-zA-Z]+)\.?(?:\s+(\d{2,4}))?$/)
  if (!m) m = s.match(/^([a-zA-Z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/)
  if (m) {
    let day: number, monthName: string, yearStr: string | undefined
    if (/^\d+$/.test(m[1])) { day = parseInt(m[1], 10); monthName = m[2]; yearStr = m[3] }
    else { monthName = m[1]; day = parseInt(m[2], 10); yearStr = m[3] }
    const month = MONTH_NAMES[monthName.toLowerCase()]
    if (month !== undefined) {
      const year = yearStr ? (yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10)) : referenceYear
      const d = new Date(Date.UTC(year, month, day))
      if (!isNaN(d.getTime()) && d.getUTCMonth() === month) return d
    }
  }

  const native = new Date(s)
  if (!isNaN(native.getTime())) return new Date(Date.UTC(native.getFullYear(), native.getMonth(), native.getDate()))
  return null
}

// Writers' tabs drift in column order, so each tab's own header row decides which column is which.
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date of posting', 'posting dates', 'posting date', 'date'],
  bucket: ['content buckets', 'bucket', 'content bucket'],
  status: ['status'],
  ideation: ['ideation', 'idea'],
  content: ['content'],
  updatedContent: ['updated content'],
  tagline: ['tagline / design reference', 'tagline/design reference', 'tagline', 'design reference'],
  creativeLink: ['creative link'],
  source: ['source'],
}
const DEFAULT_COLUMN_POSITIONS: Record<string, number> = {
  date: 0, bucket: 1, status: 2, ideation: 3, content: 4, updatedContent: 5, tagline: 6, creativeLink: 7, source: 8,
}

export type ColumnMap = Record<string, number>

export function mapColumns(headerRow: Row | undefined): ColumnMap {
  const headers = (headerRow || []).map(h => String(h ?? '').trim().toLowerCase())
  const map: ColumnMap = {}
  for (const field of Object.keys(COLUMN_ALIASES)) {
    const idx = headers.findIndex(h => COLUMN_ALIASES[field].includes(h))
    map[field] = idx !== -1 ? idx : DEFAULT_COLUMN_POSITIONS[field]
  }
  return map
}

// Some tabs have no header row at all — row 1 is already data. A numeric date cell, or an
// already-recognized status word, means row 1 is data and must not be swallowed as a header.
export function splitHeader(allRows: Row[]): { rows: Row[]; colMap: ColumnMap; hasHeader: boolean } {
  const firstRow = allRows[0]
  const firstRowIsData = !!firstRow && (
    typeof firstRow[0] === 'number' ||
    STATUSES.some(s => s.toLowerCase() === String(firstRow[2] ?? '').trim().toLowerCase())
  )
  if (firstRowIsData) return { rows: allRows, colMap: mapColumns([]), hasHeader: false }
  const [header, ...rows] = allRows
  return { rows, colMap: mapColumns(header), hasHeader: allRows.length > 0 }
}

export function columnIndexToLetter(index: number): string {
  let letter = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

export function quoteSheetName(title: string): string {
  return `'${String(title).replace(/'/g, "''")}'`
}

export function extractEmbeddedUrl(text: Cell): string | null {
  if (!text) return null
  const m = String(text).match(/https?:\/\/\S+/i)
  return m ? m[0].replace(/[)\].,]+$/, '') : null
}

export function classifyStatus(raw: Cell) {
  const s = String(raw ?? '').trim()
  if (!s) return { status: null as string | null, ...UNKNOWN_STATUS_META, isEmpty: true, isUnrecognized: false }
  if (STATUS_META[s]) return { status: s, ...STATUS_META[s], isEmpty: false, isUnrecognized: false }
  const match = STATUSES.find(v => v.toLowerCase() === s.toLowerCase())
  if (match) return { status: match, ...STATUS_META[match], isEmpty: false, isUnrecognized: false }
  return { status: s, ...UNKNOWN_STATUS_META, isEmpty: false, isUnrecognized: true }
}

// Majority year among real (numeric) dates; used to complete free-text dates that have no year.
export function referenceYearFor(tabs: { rows: Row[]; colMap: ColumnMap }[], fallbackYear: number): number {
  const counts: Record<number, number> = {}
  for (const { rows, colMap } of tabs) {
    for (const row of rows) {
      const cell = row[colMap.date]
      if (typeof cell === 'number') {
        const y = serialToDate(cell).getUTCFullYear()
        counts[y] = (counts[y] || 0) + 1
      }
    }
  }
  const entries = Object.entries(counts)
  if (!entries.length) return fallbackYear
  return Number(entries.sort((a, b) => b[1] - a[1])[0][0])
}

// A tab "looks like a client" if it has at least 3 dated rows and 3 rows with a recognized status.
export function parseTab(
  rows: Row[], colMap: ColumnMap, hyperlinks: (string | null)[], referenceYear: number,
): ParsedTab {
  const c = colMap
  const deliverables: Deliverable[] = []
  let datedCount = 0
  let recognizedCount = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const dateCell = row[c.date], bucket = row[c.bucket], statusCell = row[c.status]
    if (dateCell == null && bucket == null && statusCell == null) continue

    let date: Date | null = null
    if (typeof dateCell === 'number') date = serialToDate(dateCell)
    else if (dateCell != null && dateCell !== '') date = parseTextDate(dateCell, referenceYear)

    const st = classifyStatus(statusCell)
    if (date) datedCount++
    if (st.status && !st.isUnrecognized) recognizedCount++
    if (!date) continue   // undated rows are never shown on a calendar

    const rawLink = row[c.creativeLink] != null ? String(row[c.creativeLink]) : ''
    const resolvedLink = hyperlinks[i] || extractEmbeddedUrl(rawLink) || rawLink

    deliverables.push({
      date: date.toISOString().slice(0, 10),
      status: st.status,
      statusColor: st.color,
      statusAbbr: st.abbr,
      statusUnrecognized: st.isUnrecognized,
      bucket: row[c.bucket] != null ? String(row[c.bucket]) : '',
      content: row[c.content] != null ? String(row[c.content]) : '',
      tagline: row[c.tagline] != null ? String(row[c.tagline]) : '',
      creativeLink: resolvedLink,
    })
  }

  return { deliverables, looksLikeClient: datedCount >= 3 && recognizedCount >= 3 }
}
