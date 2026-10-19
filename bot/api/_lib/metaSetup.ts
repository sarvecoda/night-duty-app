import { jsPDF } from 'jspdf'
import { TEMPLATE_SPECS, templatePayload, type TemplateSpec } from './whatsapp.js'

const GRAPH = 'https://graph.facebook.com/v21.0'
export const WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_URL || 'https://night-duty-bot.vercel.app/api/whatsapp'

export function missingWhatsAppEnv(): string[] {
  return ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']
    .filter(name => !process.env[name]?.trim())
}

export async function connectWhatsApp(): Promise<string[]> {
  const missing = missingWhatsAppEnv()
  if (missing.length) {
    throw new Error(`Add these to bot/.env first: ${missing.join(', ')}`)
  }
  const token = process.env.WHATSAPP_ACCESS_TOKEN as string
  const appSecret = process.env.WHATSAPP_APP_SECRET as string
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID as string
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN as string
  const notes: string[] = []

  const appId = await graphGet(token, 'app').then(data => String((data as { id?: string }).id || ''))
  if (!appId) throw new Error('Meta did not return an app id for this token.')
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || await findWabaId(token, appId, appSecret)
  notes.push(`App ${appId}, WhatsApp account ${wabaId}, phone ${phoneId}`)

  await graphForm(token, `${appId}/subscriptions`, {
    object: 'whatsapp_business_account',
    callback_url: WEBHOOK_URL,
    verify_token: verifyToken,
    fields: 'messages',
  })
  await graphSend(token, `${wabaId}/subscribed_apps`, {})
  notes.push(`Webhook subscribed at ${WEBHOOK_URL}`)

  const sample = await uploadSamplePdf(token, appId)
  const existing = await graphGet(token, `${wabaId}/message_templates?limit=100`)
  const names = new Set(((existing as { data?: { name?: string }[] }).data || []).map(item => item.name))
  for (const spec of TEMPLATE_SPECS) {
    if (names.has(spec.name)) {
      notes.push(`${spec.name} already exists`)
      continue
    }
    await graphSend(token, `${wabaId}/message_templates`, templatePayload(spec, spec.header ? sample : undefined))
    notes.push(`${spec.name} submitted`)
  }
  return notes
}

async function findWabaId(token: string, appId: string, appSecret: string): Promise<string> {
  const debug = await graphGet(`${appId}|${appSecret}`, `debug_token?input_token=${encodeURIComponent(token)}`)
  const scopes = ((debug as { data?: { granular_scopes?: { scope?: string; target_ids?: string[] }[] } }).data?.granular_scopes) || []
  for (const scope of scopes) {
    const id = scope.target_ids?.[0]
    if (id && scope.scope?.includes('whatsapp_business')) return id
  }
  throw new Error('Could not find the WhatsApp business account. Set WHATSAPP_BUSINESS_ACCOUNT_ID in bot/.env.')
}

async function uploadSamplePdf(token: string, appId: string): Promise<string> {
  const doc = new jsPDF()
  doc.text('Night duty chart sample', 14, 20)
  const bytes = Buffer.from(doc.output('arraybuffer'))
  const session = await graphSend(token, `${appId}/uploads?file_name=sample.pdf&file_length=${bytes.length}&file_type=application/pdf`, {})
  const uploadId = String((session as { id?: string }).id || '')
  const response = await fetch(`${GRAPH}/${uploadId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      file_offset: '0',
      'Content-Type': 'application/pdf',
    },
    body: bytes,
  })
  const result = await response.json() as { h?: string }
  if (!response.ok || !result.h) {
    throw new Error(`Sample chart upload failed: ${JSON.stringify(result).slice(0, 200)}`)
  }
  return result.h
}

async function graphGet(token: string, path: string): Promise<unknown> {
  const response = await fetch(`${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`)
  const body = await response.json()
  if (!response.ok) throw new Error(graphError(body))
  return body
}

async function graphSend(token: string, path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(graphError(result))
  return result
}

async function graphForm(token: string, path: string, fields: Record<string, string>): Promise<void> {
  const body = new URLSearchParams({ access_token: token, ...fields })
  const response = await fetch(`${GRAPH}/${path}`, { method: 'POST', body })
  const result = await response.json()
  if (!response.ok) throw new Error(graphError(result))
}

function graphError(body: unknown): string {
  const message = (body as { error?: { message?: string } })?.error?.message
  return message || JSON.stringify(body).slice(0, 300)
}

export function buttonLabels(spec: TemplateSpec): string[] {
  return spec.buttons.map(button => button.text)
}
