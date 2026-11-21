// POSTs to the server. Neither function rejects, neither touches the
// store, and the caller's text goes out exactly as given.
import type { Intent, ListResult, OpenResult, PostResult, StopResult, WorkspaceItem } from './types.ts'

/** A POST that has not answered in this long resolves {status: 0, error: 'timeout'}. */
export const POST_TIMEOUT_MS = 15_000

async function post(url: string, body: unknown): Promise<PostResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let error: string | null = res.ok ? null : 'http'
    let id: string | undefined
    try {
      const data = (await res.json()) as { error?: unknown; id?: unknown } | null
      if (data && typeof data.error === 'string') error = data.error
      if (data && typeof data.id === 'string') id = data.id
    } catch {
      // body is not JSON; keep the status-derived error
    }
    return id === undefined ? { status: res.status, error } : { status: res.status, error, id }
  } catch {
    return { status: 0, error: controller.signal.aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** Sends {text}, or {text, intent} when an intent is given; a 202 body's id comes back as id. */
export function postMessage(text: string, intent?: Intent): Promise<PostResult> {
  return post('/api/message', intent === undefined ? { text } : { text, intent })
}

export function postAnswer(id: string, body: unknown): Promise<PostResult> {
  return post(`/api/requests/${encodeURIComponent(id)}/answer`, body)
}

/** Runs a request with the same 15 s abort; resolves the status and the parsed JSON body (null when it is not JSON). */
async function request(url: string, init: RequestInit): Promise<{ status: number; data: Record<string, unknown> | null; failed: "timeout" | "network" | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    let data: Record<string, unknown> | null = null
    try {
      const body = (await res.json()) as unknown
      if (body !== null && typeof body === 'object') data = body as Record<string, unknown>
    } catch {
      // body is not JSON
    }
    return { status: res.status, data, failed: null }
  } catch {
    return { status: 0, data: null, failed: controller.signal.aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** GET /api/workspaces. A 401 or 403 sets expired: the caller stops asking. Never rejects. */
export async function getWorkspaces(): Promise<ListResult> {
  const r = await request('/api/workspaces', { method: 'GET' })
  const list = r.data?.workspaces
  // The single-repo server answers 200 {workspaces: null, single: true}: the same outcome as the 404 an older one gave.
  if (r.status === 200 && r.data?.single === true) return { ok: false, status: 404, expired: false }
  if (r.status === 200 && Array.isArray(list)) return { ok: true, workspaces: list as WorkspaceItem[] }
  return { ok: false, status: r.status, expired: r.status === 401 || r.status === 403 }
}

/** POST /api/workspaces {path}: aborts at 15 s with status 0 and error "stuck". Never rejects. */
export async function openWorkspace(path: string): Promise<OpenResult> {
  const r = await request('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
  const w = r.data?.workspace
  if ((r.status === 200 || r.status === 201) && r.data?.ok === true && w !== null && typeof w === "object") {
    return { ok: true, workspace: w as WorkspaceItem, existed: r.data.existed === true }
  }
  const error = r.failed === 'timeout' ? 'stuck' : r.failed ?? (typeof r.data?.error === 'string' ? r.data.error : 'http')
  return { ok: false, error, status: r.status }
}

/** POST /api/workspaces/<id>/stop. Never rejects. */
export async function stopWorkspace(id: string): Promise<StopResult> {
  const r = await request(`/api/workspaces/${encodeURIComponent(id)}/stop`, { method: "POST" })
  const w = r.data?.workspace
  if (r.status === 200 && r.data?.ok === true && w !== null && typeof w === "object") return { ok: true, workspace: w as WorkspaceItem }
  return { ok: false, status: r.status, error: r.failed ?? (typeof r.data?.error === 'string' ? r.data.error : 'http') }
}

/** postMessage to one workspace; the empty id is a single-repo server's one repository (un-scoped route). */
export function postWorkspaceMessage(id: string, text: string, intent?: Intent): Promise<PostResult> {
  if (id === '') return postMessage(text, intent)
  return post(`/api/workspaces/${encodeURIComponent(id)}/message`, intent === undefined ? { text } : { text, intent })
}

/** postAnswer to one workspace; the empty id is the single-repo server's un-scoped route. */
export function postWorkspaceAnswer(id: string, requestId: string, body: unknown): Promise<PostResult> {
  if (id === '') return postAnswer(requestId, body)
  return post(`/api/workspaces/${encodeURIComponent(id)}/requests/${encodeURIComponent(requestId)}/answer`, body)
}
