// Growthic One — Edge Function: move-client-folder
// Moves a client's Drive folders when their status changes
// (e.g. active → paused, paused → inactive, etc.)
//
// Moves in TWO Shared Drives:
//   BD Drive  : Client Directory / {old} Clients / {Client Name}
//            → Client Directory / {new} Clients / {Client Name}
//
//   Ops Drive : {old} Clients / {Client Name}
//            → {new} Clients / {Client Name}
//
// If the client folder doesn't exist in a drive (no uploads yet), skip silently.
//
// Env vars required:
//   GOOGLE_DRIVE_BD_DRIVE_ID    — Business Development Shared Drive ID
//   GOOGLE_DRIVE_OPS_DRIVE_ID   — Operations Shared Drive ID
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL / SUPABASE_ANON_KEY

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function statusFolder(status: string): string {
  if (status === 'paused')   return 'Paused Clients'
  if (status === 'inactive') return 'Inactive Clients'
  return 'Active Clients'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json() as {
      client_name: string
      old_status:  string
      new_status:  string
    }

    const { client_name, old_status, new_status } = body
    if (!client_name || !old_status || !new_status) {
      return json({ error: 'client_name, old_status, and new_status are required.' }, 400)
    }

    const oldFolder = statusFolder(old_status)
    const newFolder = statusFolder(new_status)

    // Nothing to move if status category didn't change
    if (oldFolder === newFolder) return json({ moved: false, reason: 'same folder category' })

    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)
    const bdRootId    = Deno.env.get('GOOGLE_DRIVE_BD_DRIVE_ID')!
    const opsRootId   = Deno.env.get('GOOGLE_DRIVE_OPS_DRIVE_ID')!
    const name        = client_name.trim()

    const results: Record<string, string> = {}

    // ── BD Drive ──────────────────────────────────────────────
    // Path: Client Directory / {status} Clients / {Client Name}
    const bdClientDir = await findFolder(accessToken, 'Client Directory', bdRootId)
    if (bdClientDir) {
      const bdOldParent = await findFolder(accessToken, oldFolder, bdClientDir)
      const bdNewParent = await ensureFolder(accessToken, newFolder, bdClientDir)
      if (bdOldParent) {
        const bdClientFolder = await findFolder(accessToken, name, bdOldParent)
        if (bdClientFolder) {
          await moveFolder(accessToken, bdClientFolder, bdOldParent, bdNewParent)
          results.bd = 'moved'
        } else {
          results.bd = 'not_found'
        }
      } else {
        results.bd = 'old_parent_not_found'
      }
    } else {
      results.bd = 'client_directory_not_found'
    }

    // ── Ops Drive ─────────────────────────────────────────────
    // Path: {status} Clients / {Client Name}
    const opsOldParent = await findFolder(accessToken, oldFolder, opsRootId)
    const opsNewParent = await ensureFolder(accessToken, newFolder, opsRootId)
    if (opsOldParent) {
      const opsClientFolder = await findFolder(accessToken, name, opsOldParent)
      if (opsClientFolder) {
        await moveFolder(accessToken, opsClientFolder, opsOldParent, opsNewParent)
        results.ops = 'moved'
      } else {
        results.ops = 'not_found'
      }
    } else {
      results.ops = 'old_parent_not_found'
    }

    return json({ moved: true, results })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

/* ── Google Drive helpers ─────────────────────────────────── */

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }
  const b64url = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const signingInput = `${b64url(header)}.${b64url(payload)}`
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/,'').replace(/-----END PRIVATE KEY-----/,'')
    .replace(/\\n/g,'\n').replace(/\n/g,'')
  const keyBytes  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signingInput}.${sig}`,
  })
  const td = await tokenRes.json() as { access_token: string }
  return td.access_token
}

/** Find an existing folder by name under a parent. Returns null if not found. */
async function findFolder(token: string, name: string, parentId: string): Promise<string | null> {
  const q = `name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const sr = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers:{ Authorization:`Bearer ${token}` } },
  )
  const sd = await sr.json() as { files: { id: string }[] }
  return sd.files?.length > 0 ? sd.files[0].id : null
}

/** Find or create a folder by name under a parent. */
async function ensureFolder(token: string, name: string, parentId: string): Promise<string> {
  const existing = await findFolder(token, name, parentId)
  if (existing) return existing
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ name, mimeType:'application/vnd.google-apps.folder', parents:[parentId] }),
  })
  const cd = await cr.json() as { id?: string; error?: unknown }
  if (!cd.id) throw new Error(`Drive folder create failed: ${JSON.stringify(cd.error || cd)}`)
  return cd.id
}

/** Move a folder from oldParent to newParent using Drive files.update. */
async function moveFolder(token: string, folderId: string, oldParentId: string, newParentId: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?addParents=${newParentId}&removeParents=${oldParentId}&supportsAllDrives=true&fields=id`,
    { method:'PATCH', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body: '{}' },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Drive folder move failed: ${JSON.stringify(err)}`)
  }
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
