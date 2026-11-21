// Routing and POST bodies.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionControl, StateSource, WorkspaceSource } from './index.ts';
import type { SseHub } from './sse.ts';
import { serveImage, serveMarked, serveStatic } from './static.ts';

const MAX_BODY = 1024 * 1024;

export const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
};

const tooBig = (req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
  res.end('{"error":"toolarge"}', () => req.socket.destroy());
};

// A chunked upload that goes over the limit mid-stream: drop the rest of the body, then answer 413 once it
// ends. Answering while the client is still sending closes the socket on unread bytes, which sends an RST,
// and on Windows the RST throws the 413 away before the client reads it. A client that keeps sending past
// DRAIN_MS gets the 413 and the socket destroyed.
const DRAIN_MS = 2000;
const tooBigAfterDrain = (req: IncomingMessage, res: ServerResponse) => {
  let done = false;
  const answer = () => { if (!done) { done = true; clearTimeout(t); tooBig(req, res); } };
  const t = setTimeout(answer, DRAIN_MS);
  t.unref();
  req.on('end', answer);
  req.resume();
};

// Resolves with the body text, or null after it has already answered 413.
function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY) { tooBig(req, res); resolve(null); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; tooBigAfterDrain(req, res); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => { if (!over) { over = true; resolve(null); } });
    req.on('close', () => { if (!over && !req.complete) { over = true; resolve(null); } });
  });
}

async function readJson(req: IncomingMessage, res: ServerResponse): Promise<{ value: any } | null> {
  const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') {
    sendJson(res, 415, { error: 'type' });
    req.resume();
    return null;
  }
  const text = await readBody(req, res);
  if (text === null) return null;
  try { return { value: JSON.parse(text) }; } catch { sendJson(res, 400, { error: 'json' }); return null; }
}

const ANSWER_STATUS: Record<string, number> = { unknown: 404, answered: 409, cancelled: 409, answer: 400 };

// What the routes act on: one workspace's state and session, or the single pair the server was given.
interface Target { state: StateSource; session: SessionControl; sse: SseHub }

async function postMessage(t: Target, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req, res);
  if (!body) return;
  const r = t.session.send(body.value?.text, body.value?.intent);
  if (r.ok) return sendJson(res, 202, { ok: true, id: r.id });
  return sendJson(res, r.error === 'ended' ? 409 : 400, { error: r.error });
}

async function postAnswer(t: Target, rawId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req, res);
  if (!body) return;
  let id: string;
  try { id = decodeURIComponent(rawId); } catch { return sendJson(res, 404, { error: 'unknown' }); }
  const r = t.session.answer(id, body.value);
  if (r.ok) return sendJson(res, 200, { ok: true, request: r.request });
  return sendJson(res, ANSWER_STATUS[r.error] ?? 400, r.request ? { error: r.error, request: r.request } : { error: r.error });
}

// POST /api/workspaces: 201 for a new workspace, 200 for one that was already open, 400 or 504 with the named error.
async function openWorkspace(ws: WorkspaceSource, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req, res);
  if (!body) return;
  const r = await ws.open(body.value?.path);
  if (r.ok) {
    // The open answer always names `session` (false when no process exists): the page says "No session yet" from `session === false`, so an absent flag would show the recorded run's word until the 2 s list poll.
    const workspace = { ...(r.workspace as object), session: (r.workspace as { session?: boolean }).session === true };
    return sendJson(res, r.existed ? 200 : 201, { ok: true, workspace, existed: r.existed });
  }
  return sendJson(res, r.error === 'timeout' ? 504 : 400, { error: r.error });
}

// The /api/workspaces routes. A known sub-route on an unknown workspace is 404 `workspace`.
async function workspaceRoute(
  opts: RouteOpts & { workspaces: WorkspaceSource; hubFor: (state: StateSource) => SseHub },
  path: string,
  params: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  const ws = opts.workspaces;
  if (path === '/api/workspaces') {
    if (method === 'GET') return sendJson(res, 200, { workspaces: ws.list() });
    if (method === 'POST') return openWorkspace(ws, req, res);
    return sendJson(res, 405, { error: 'method' });
  }
  const m = /^\/api\/workspaces\/([^/]+)\/(stop|events|message|image|requests\/([^/]+)\/answer)$/.exec(path);
  if (!m) return sendJson(res, 404, { error: 'notfound' });
  const sub = m[2]!;
  const wanted = sub === 'events' || sub === 'image' ? 'GET' : 'POST';
  if (method !== wanted) return sendJson(res, 405, { error: 'method' });
  let id = '';
  try { id = decodeURIComponent(m[1]!); } catch { /* no such workspace */ }
  if (sub === 'stop') {
    const stopped = await readBody(req, res); // drained, and 413 when it is too big; the body itself means nothing
    if (stopped === null) return;
    const r = await ws.stop(id);
    return r.ok ? sendJson(res, 200, { ok: true, workspace: r.workspace }) : sendJson(res, 404, { error: 'workspace' });
  }
  const w = ws.get(id);
  if (!w) return sendJson(res, 404, { error: 'workspace' });
  const t: Target = { state: w.state, session: w.control, sse: opts.hubFor(w.state) };
  if (sub === 'events') return t.sse.handle(req, res);
  if (sub === 'message') return postMessage(t, req, res);
  if (sub === 'image') return serveImage(t.state, params, res);
  return postAnswer(t, m[3]!, req, res);
}

export interface RouteOpts {
  state?: StateSource;
  session?: SessionControl;
  webDir: string;
  workspaces?: WorkspaceSource;
  hubFor?: (state: StateSource) => SseHub; // the SSE hub of one workspace's state; createServer makes it
}

export async function route(
  opts: RouteOpts,
  sse: SseHub | null,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1));

  const isApi = path === '/api' || path.startsWith('/api/');
  if (opts.workspaces && opts.hubFor && (path === '/api/workspaces' || path.startsWith('/api/workspaces/'))) {
    return workspaceRoute({ ...opts, workspaces: opts.workspaces, hubFor: opts.hubFor }, path, params, req, res);
  }
  // The single-repo server (no registry) says so, so the page takes it as one repository without a failed request.
  if (!opts.workspaces && opts.state && path === '/api/workspaces' && method === 'GET') {
    return sendJson(res, 200, { workspaces: null, single: true });
  }
  // The un-scoped routes act on the --repo workspace when the server has a registry, else on the pair it was given.
  let target: Target | null = null;
  if (opts.workspaces && opts.hubFor) {
    const p = opts.workspaces.primary();
    if (p) target = { state: p.state, session: p.control, sse: opts.hubFor(p.state) };
  } else if (opts.state && opts.session && sse) {
    target = { state: opts.state, session: opts.session, sse };
  }
  const noWorkspace = () => sendJson(res, 404, { error: 'workspace' });

  if (path === '/api/events') {
    if (method !== 'GET') return sendJson(res, 405, { error: 'method' });
    return target ? target.sse.handle(req, res) : noWorkspace();
  }
  if (path === '/api/message') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method' });
    return target ? postMessage(target, req, res) : noWorkspace();
  }
  const m = /^\/api\/requests\/([^/]+)\/answer$/.exec(path);
  if (m) {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method' });
    return target ? postAnswer(target, m[1]!, req, res) : noWorkspace();
  }
  if (path === '/api/image') {
    if (method !== 'GET') return sendJson(res, 405, { error: 'method' });
    return target ? serveImage(target.state, params, res) : noWorkspace();
  }
  if (isApi) return sendJson(res, 404, { error: 'notfound' });
  if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'method' });
  if (path === '/vendor/marked.js') return serveMarked(res);
  return serveStatic(opts.webDir, path, res);
}
