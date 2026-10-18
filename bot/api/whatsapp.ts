import { waitUntil } from '@vercel/functions'
import { handleInbound } from './_lib/inbound.ts'
import { claimInbox, saintByPhone } from './_lib/roster.ts'
import { parseInbound, verifySignature, type Inbound } from './_lib/whatsapp.ts'

export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token') || ''
  const challenge = url.searchParams.get('hub.challenge') || ''
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || ''
  if (!expected || mode !== 'subscribe' || token !== expected || !challenge) {
    return new Response('Forbidden', { status: 403 })
  }
  return new Response(challenge, { headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) return new Response('WhatsApp app secret is missing', { status: 503 })
  const raw = await request.text()
  const header = request.headers.get('x-hub-signature-256') || undefined
  if (!verifySignature(raw, header, secret)) return new Response('Unauthorized', { status: 401 })

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const incoming = parseInbound(body)
  const fresh: Inbound[] = []
  try {
    for (const message of incoming) {
      if (!message.wamid) continue
      if (await claimInbox(message.wamid, message.from, message.text)) fresh.push(message)
    }
  } catch (error) {
    console.error('inbox write failed', error)
    return new Response('retry', { status: 500 })
  }

  waitUntil(processFresh(fresh))
  return new Response('ok')
}

async function processFresh(messages: Inbound[]) {
  for (const message of messages) {
    try {
      const saint = await saintByPhone(message.from)
      if (!saint) continue
      await handleInbound(message, saint)
    } catch (error) {
      console.error('inbound failed', message.wamid, error)
    }
  }
}
