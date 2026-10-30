import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  classifyStatus, columnIndexToLetter, extractEmbeddedUrl, mapColumns, parseTab, parseTextDate,
  quoteSheetName, referenceYearFor, serialToDate, splitHeader,
} from './parse.ts'
import { reconcileTabs } from './reconcile.ts'

const iso = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null

Deno.test('serialToDate converts Google serials', () => {
  assertEquals(iso(serialToDate(46000)), '2025-12-09')   // 46000 days after 1899-12-30
  assertEquals(iso(serialToDate(25569)), '1970-01-01')
})

Deno.test('parseTextDate handles the formats writers use', () => {
  assertEquals(iso(parseTextDate('22nd June', 2026)), '2026-06-22')
  assertEquals(iso(parseTextDate('22 June 2026', 2026)), '2026-06-22')
  assertEquals(iso(parseTextDate('22/06/2026', 2026)), '2026-06-22')
  assertEquals(iso(parseTextDate('22-06-26', 2026)), '2026-06-22')
  assertEquals(iso(parseTextDate('June 22', 2027)), '2027-06-22')
  assertEquals(iso(parseTextDate('Oct 5, 2026', 2026)), '2026-10-05')
  assertEquals(parseTextDate('31/02/2026', 2026) === null || iso(parseTextDate('31/02/2026', 2026)) !== '2026-02-31', true)
  assertEquals(parseTextDate('', 2026), null)
  assertEquals(parseTextDate('not a date', 2026), null)
  assertEquals(parseTextDate(null, 2026), null)
})

Deno.test('classifyStatus: 9 statuses, tolerant of case, flags typos', () => {
  assertEquals(classifyStatus('Posted').abbr, 'PO')
  assertEquals(classifyStatus('posted ').status, 'Posted')
  assertEquals(classifyStatus('Client Approved').abbr, 'CLA')
  const typo = classifyStatus('Postd')
  assertEquals(typo.isUnrecognized, true)
  assertEquals(typo.abbr, '?')
  assertEquals(typo.status, 'Postd')
  assertEquals(classifyStatus('').isEmpty, true)
  assertEquals(classifyStatus(undefined).status, null)
})

Deno.test('mapColumns reads the header, falls back to fixed positions', () => {
  const m = mapColumns(['Date of Posting', 'Content Buckets', 'Idea', 'Status', 'Content', 'Updated Content', 'Tagline / Design Reference', 'Creative Link', 'Source'])
  assertEquals(m.date, 0); assertEquals(m.status, 3); assertEquals(m.ideation, 2); assertEquals(m.creativeLink, 7)
  const blank = mapColumns([])
  assertEquals(blank.status, 2); assertEquals(blank.date, 0)
})

Deno.test('splitHeader: header row dropped, headerless tab keeps row 1', () => {
  const withHeader = splitHeader([['Date', 'Bucket', 'Status'], [46000, 'x', 'Posted']])
  assertEquals(withHeader.rows.length, 1); assertEquals(withHeader.hasHeader, true)
  const headerless = splitHeader([[46000, 'x', 'Posted'], [46001, 'y', 'Delivered']])
  assertEquals(headerless.rows.length, 2); assertEquals(headerless.hasHeader, false)
  const headerlessByStatus = splitHeader([['22 June', 'x', 'Ideation']])
  assertEquals(headerlessByStatus.rows.length, 1); assertEquals(headerlessByStatus.hasHeader, false)
})

Deno.test('helpers', () => {
  assertEquals(columnIndexToLetter(0), 'A'); assertEquals(columnIndexToLetter(7), 'H'); assertEquals(columnIndexToLetter(26), 'AA')
  assertEquals(quoteSheetName("Joe's Tab"), "'Joe''s Tab'")
  assertEquals(extractEmbeddedUrl('see https://x.com/a/b). thanks'), 'https://x.com/a/b')
  assertEquals(extractEmbeddedUrl('no link'), null)
})

Deno.test('parseTab: dates, statuses, links, looksLikeClient', () => {
  const header = ['Date of Posting', 'Content Buckets', 'Status', 'Ideation', 'Content', 'Updated Content', 'Tagline', 'Creative Link', 'Source']
  const rows = [
    [46000, 'Edu', 'Posted', 'i', 'c1', '', 'tag1', 'Pre Post', ''],
    [46001, 'Edu', 'Delivered', 'i', 'c2', '', '', 'https://drive.google.com/x', ''],
    ['22nd June', 'Pro', 'Rework', '', 'c3', '', '', '', ''],
    ['garbage', 'Pro', 'Posted', '', 'c4', '', '', '', ''],   // undated: dropped, but its status still counts
    [null, null, null],
  ]
  const { rows: data, colMap } = splitHeader([header, ...rows])
  const r = parseTab(data, colMap, [ 'https://attached.example/1', null, null, null ], 2026)
  assertEquals(r.deliverables.length, 3)
  assertEquals(r.deliverables[0].creativeLink, 'https://attached.example/1')   // attached hyperlink wins
  assertEquals(r.deliverables[1].creativeLink, 'https://drive.google.com/x')
  assertEquals(r.deliverables[2].date, '2026-06-22')
  assertEquals(r.deliverables[0].statusColor, 'green')
  assertEquals(r.looksLikeClient, true)   // 3 dated rows, 4 recognized statuses
  assertEquals('ideation' in r.deliverables[0], false)   // payload trimmed to what the Calendar uses
})

Deno.test('parseTab: KPI-style tab does not look like a client', () => {
  const { rows, colMap } = splitHeader([['Metric', 'Value'], ['Reach', 100], ['Likes', 20]])
  assertEquals(parseTab(rows, colMap, [], 2026).looksLikeClient, false)
})

Deno.test('referenceYearFor: majority year of real dates', () => {
  const colMap = mapColumns([])
  const y = referenceYearFor([{ rows: [[46000], [46001], [40000]], colMap }], 1999)
  assertEquals(y, 2025)
  assertEquals(referenceYearFor([{ rows: [['22 June']], colMap }], 2031), 2031)
})

/* ── reconcileTabs against a fake database ─────────────────── */

function fakeAdmin(initial: Record<string, unknown>[]) {
  const rows = initial.map(r => ({ ...r }))
  const calls: string[] = []
  const admin = {
    from: (_t: string) => ({
      select: () => ({ eq: (_c: string, _v: string) => Promise.resolve({ data: rows.map(r => ({ ...r })), error: null }) }),
      upsert: (list: Record<string, unknown>[], _o: unknown) => {
        for (const l of list) if (!rows.some(r => r.gid === l.gid)) rows.push({ ...l })
        calls.push(`upsert:${list.length}`); return Promise.resolve({ error: null })
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (_a: string, _b: string) => ({
          eq: (_c: string, gid: number) => {
            const row = rows.find(r => r.gid === gid)
            if (row) Object.assign(row, patch)
            calls.push(`update:${gid}`); return Promise.resolve({ error: null })
          },
        }),
      }),
    }),
  }
  return { admin, rows, calls }
}
const S = 'sheet1'
const row = (gid: number, name: string, hidden: boolean, sid: string | null = null, sg: string | null = null) =>
  ({ spreadsheet_id: S, gid, tab_name: name, source_id: sid, source_gid: sg, hidden })
const tab = (gid: number, name: string, looks = true, sid: string | null = null, sg: string | null = null) =>
  ({ gid, name, sourceId: sid, sourceGid: sg, looksLikeClient: looks })

Deno.test('reconcile: known tab keeps its choice; rename only updates the name', async () => {
  const f = fakeAdmin([row(10, 'Old Name', true)])
  const res = await reconcileTabs(f.admin, S, [tab(10, 'New Name')])
  assertEquals(res.get(10), true)
  assertEquals(f.rows[0].tab_name, 'New Name')
  assertEquals(f.rows.length, 1)
})

Deno.test('reconcile: brand-new tabs default by looksLikeClient', async () => {
  const f = fakeAdmin([])
  const res = await reconcileTabs(f.admin, S, [tab(1, 'Acme', true), tab(2, 'KPIs', false)])
  assertEquals(res.get(1), false)
  assertEquals(res.get(2), true)
  assertEquals(f.rows.length, 2)
})

Deno.test('reconcile: recreated tab re-linked by source tag, keeps hidden choice', async () => {
  const f = fakeAdmin([row(10, 'Acme', true, 'SRC', '77')])
  const res = await reconcileTabs(f.admin, S, [tab(99, 'Acme (copy)', true, 'SRC', '77')])
  assertEquals(res.get(99), true)
  assertEquals(f.rows.length, 1)
  assertEquals(f.rows[0].gid, 99)
})

Deno.test('reconcile: re-link by unambiguous name when no source tag', async () => {
  const f = fakeAdmin([row(10, 'Acme', true)])
  const res = await reconcileTabs(f.admin, S, [tab(55, 'Acme')])
  assertEquals(res.get(55), true)
  assertEquals(f.rows[0].gid, 55)
})

Deno.test('reconcile: ambiguous name is NOT re-linked (treated as new)', async () => {
  const f = fakeAdmin([row(10, 'Acme', true), row(11, 'Acme', false)])
  const res = await reconcileTabs(f.admin, S, [tab(55, 'Acme', true)])
  assertEquals(res.get(55), false)         // new tab, looks like a client → shown
  assertEquals(f.rows.some(r => r.gid === 55), true)
  assertEquals(f.rows.length, 3)
})

Deno.test('reconcile: two new tabs with the same name are not re-linked to one orphan', async () => {
  const f = fakeAdmin([row(10, 'Acme', true)])
  const res = await reconcileTabs(f.admin, S, [tab(55, 'Acme', true), tab(56, 'Acme', true)])
  assertEquals(res.get(55), false); assertEquals(res.get(56), false)
  assert(f.rows.some(r => r.gid === 10))   // orphan untouched
})

Deno.test('reconcile: a DB write failure does not stop the calendar', async () => {
  const admin = {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      upsert: () => Promise.reject(new Error('db down')),
    }),
  }
  const res = await reconcileTabs(admin, S, [tab(1, 'Acme', true)])
  assertEquals(res.get(1), false)
})
