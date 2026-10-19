import { getAuth } from 'firebase-admin/auth'
import { answer, WEB_REFUSAL } from './_lib/agent.js'
import { istDate } from './_lib/pure.js'
import { firestore, type ChatTurn } from './_lib/roster.js'
import type { Caller } from './_lib/tools.js'

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'https://night-duty-app.web.app',
  'https://night-duty-app.firebaseapp.com',
])

export const maxDuration = 120

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export async function POST(request: Request): Promise<Response> {
  const headers = corsHeaders(request)
  const origin = request.headers.get('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: 'Origin not allowed' }, 403, headers)
  }

  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return json({ error: 'Sign in again.' }, 401, headers)
  try {
    firestore()
    await getAuth().verifyIdToken(token)
  } catch (error) {
    console.error('chat auth failed', error)
    return json({ error: 'Sign in again.' }, 401, headers)
  }

  let body: { message?: unknown; history?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Bad request' }, 400, headers)
  }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : ''
  if (!message) return json({ error: 'Type a question.' }, 400, headers)

  const caller: Caller = {
    saint: {
      id: 'web',
      name: 'Roster admin',
      mobile: '',
      isEmergencyDuty: false,
      isUnavailableForDuty: false,
      isAdmin: true,
      createdAt: '',
    },
    waId: '',
    today: istDate(),
  }
  const result = await answer(caller, message, historyOf(body.history), 'web')
  if (result.counted === false && result.text.includes('busy')) {
    return json({ error: result.text }, 429, headers)
  }
  if (result.counted === false && result.text.includes('not set up')) {
    return json({ error: result.text }, 503, headers)
  }
  return json({ reply: result.text || WEB_REFUSAL }, 200, headers)
}

function historyOf(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return []
  return value.slice(-8).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const turn = item as { role?: unknown; content?: unknown }
    if ((turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string') return []
    return [{ role: turn.role, content: turn.content.slice(0, 500) }]
  })
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers()
  const origin = request.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return headers
}

function json(body: unknown, status: number, headers: Headers): Response {
  const next = new Headers(headers)
  next.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers: next })
}
