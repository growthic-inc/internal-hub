// Growthic One — delivery-calendar: match the sheet's tabs to the saved hide/show rows.
// Kept separate from index.ts (which starts a server on import) so it can be tested with a fake database.

export interface TabIdentity {
  gid: number
  name: string
  sourceId: string | null
  sourceGid: string | null
  looksLikeClient: boolean
}

/* ── Shared hidden list: match tabs to saved rows ───────────── */

interface TabRow {
  spreadsheet_id: string; gid: number; tab_name: string | null
  source_id: string | null; source_gid: string | null; hidden: boolean
}

// Identifies each tab by Master GID first. If a GID is new, the saved row of a tab that has
// vanished is re-linked when it carries the same source tag, or (only if unambiguous) the
// same name — so the hide/show choice survives a recreated tab. Anything else is a new tab:
// shown only if it looks like a client tab.
export async function reconcileTabs(
  // deno-lint-ignore no-explicit-any
  admin: any, sheetId: string, tabs: TabIdentity[],
): Promise<Map<number, boolean>> {
  const { data, error } = await admin.from('delivery_calendar_tabs').select('*').eq('spreadsheet_id', sheetId)
  if (error) throw new Error(`Could not read the hidden-tabs list: ${error.message}`)

  const rows = (data || []) as TabRow[]
  const byGid   = new Map(rows.map(r => [Number(r.gid), r]))
  const present = new Set(tabs.map(t => t.gid))
  const orphans = rows.filter(r => !present.has(Number(r.gid)))
  const used    = new Set<TabRow>()
  const norm    = (s: string | null) => (s ?? '').trim().toLowerCase()

  const result  = new Map<number, boolean>()
  const inserts: Record<string, unknown>[] = []
  const metaUpdates: { gid: number; patch: Record<string, unknown> }[] = []
  const relinks: { from: number; tab: TabIdentity; hidden: boolean }[] = []

  const newTabs = tabs.filter(t => !byGid.has(t.gid))
  const newNameCount = new Map<string, number>()
  for (const t of newTabs) newNameCount.set(norm(t.name), (newNameCount.get(norm(t.name)) ?? 0) + 1)

  for (const t of tabs) {
    const row = byGid.get(t.gid)
    if (row) {
      result.set(t.gid, row.hidden)
      const patch: Record<string, unknown> = {}
      if (row.tab_name !== t.name) patch.tab_name = t.name
      if (t.sourceId  && row.source_id  !== t.sourceId)  patch.source_id  = t.sourceId
      if (t.sourceGid && row.source_gid !== t.sourceGid) patch.source_gid = t.sourceGid
      if (Object.keys(patch).length) metaUpdates.push({ gid: t.gid, patch })
      continue
    }

    let match: TabRow | undefined
    if (t.sourceId && t.sourceGid) {
      match = orphans.find(o => !used.has(o) && o.source_id === t.sourceId && o.source_gid === t.sourceGid)
    }
    if (!match && norm(t.name) && newNameCount.get(norm(t.name)) === 1) {
      const sameName = orphans.filter(o => !used.has(o) && norm(o.tab_name) === norm(t.name))
      if (sameName.length === 1) match = sameName[0]
    }

    if (match) {
      used.add(match)
      relinks.push({ from: Number(match.gid), tab: t, hidden: match.hidden })
      result.set(t.gid, match.hidden)
    } else {
      const hidden = !t.looksLikeClient
      inserts.push({
        spreadsheet_id: sheetId, gid: t.gid, tab_name: t.name,
        source_id: t.sourceId, source_gid: t.sourceGid, hidden,
      })
      result.set(t.gid, hidden)
    }
  }

  // Writes are best-effort: a failure here must not stop the calendar from loading.
  try {
    if (inserts.length) {
      await admin.from('delivery_calendar_tabs')
        .upsert(inserts, { onConflict: 'spreadsheet_id,gid', ignoreDuplicates: true })
    }
    for (const r of relinks) {
      await admin.from('delivery_calendar_tabs')
        .update({ gid: r.tab.gid, tab_name: r.tab.name, source_id: r.tab.sourceId, source_gid: r.tab.sourceGid })
        .eq('spreadsheet_id', sheetId).eq('gid', r.from)
    }
    for (const u of metaUpdates) {
      await admin.from('delivery_calendar_tabs').update(u.patch).eq('spreadsheet_id', sheetId).eq('gid', u.gid)
    }
  } catch (err) {
    console.error('delivery-calendar: could not save tab changes:', err)
  }

  return result
}

