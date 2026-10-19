import { createHmac, timingSafeEqual } from 'node:crypto'
import { flatten } from './pure.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

export interface Inbound {
  wamid: string
  from: string
  type: 'text' | 'audio' | 'image' | 'other'
  text: string
  buttonId?: string
  buttonTitle?: string
}

export interface OutButton {
  id: string
  title: string
}

export function verifySignature(raw: string, header: string | undefined, secret: string | undefined): boolean {
  if (!header || !secret) return false
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
  const left = Buffer.from(expected)
  const right = Buffer.from(header)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function parseInbound(body: unknown): Inbound[] {
  const entries = (body as { entry?: unknown[] })?.entry
  if (!Array.isArray(entries)) return []
  const messages: Inbound[] = []
  for (const entry of entries) {
    const changes = (entry as { changes?: { value?: { messages?: Record<string, unknown>[] } }[] }).changes || []
    for (const change of changes) {
      for (const message of change.value?.messages || []) {
        messages.push(normalizeMessage(message))
      }
    }
  }
  return messages
}

function normalizeMessage(message: Record<string, unknown>): Inbound {
  const base = {
    wamid: String(message.id || ''),
    from: String(message.from || ''),
    text: '',
  }
  if (message.type === 'text') {
    const body = String((message.text as { body?: string } | undefined)?.body || '')
    return { ...base, type: 'text', text: body.slice(0, 1000) }
  }
  if (message.type === 'interactive') {
    const interactive = message.interactive as { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } }
    const choice = interactive?.button_reply || interactive?.list_reply
    return {
      ...base,
      type: 'text',
      buttonId: choice?.id,
      buttonTitle: choice?.title,
      text: String(choice?.title || '').slice(0, 1000),
    }
  }
  if (message.type === 'button') {
    const button = message.button as { payload?: string; text?: string }
    return {
      ...base,
      type: 'text',
      buttonId: button?.payload,
      buttonTitle: button?.text,
      text: String(button?.text || '').slice(0, 1000),
    }
  }
  if (message.type === 'audio' || message.type === 'image' || message.type === 'video' || message.type === 'sticker') {
    return { ...base, type: message.type === 'audio' ? 'audio' : 'image' }
  }
  return { ...base, type: 'other' }
}

function graphConfig() {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!phoneId || !token) throw new Error('WhatsApp credentials are missing')
  return { phoneId, token }
}

async function graph(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const { token } = graphConfig()
  const response = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`WhatsApp ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) as Record<string, unknown> : {}
}

export async function uploadPdf(buffer: Buffer, filename: string): Promise<string> {
  const { phoneId } = graphConfig()
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', 'application/pdf')
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), filename)
  const result = await graph(`${phoneId}/media`, { method: 'POST', body: form })
  return String(result.id || '')
}

export async function sendText(to: string, text: string, buttons?: OutButton[]): Promise<void> {
  const { phoneId } = graphConfig()
  const body = text.slice(0, 1024) || ' '
  let payload: Record<string, unknown>
  if (buttons && buttons.length > 3) {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: 'Choose',
          sections: [{
            title: 'Options',
            rows: buttons.slice(0, 10).map(button => ({
              id: button.id.slice(0, 200),
              title: button.title.slice(0, 24),
            })),
          }],
        },
      },
    }
  } else if (buttons && buttons.length > 0) {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3).map(button => ({
            type: 'reply',
            reply: { id: button.id.slice(0, 200), title: button.title.slice(0, 20) },
          })),
        },
      },
    }
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text.slice(0, 4000) || ' ' },
    }
  }
  await graph(`${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function sendTemplate(to: string, name: string, bodyParams: string[], document?: { id: string; filename: string }): Promise<void> {
  const { phoneId } = graphConfig()
  const components: Record<string, unknown>[] = []
  if (document?.id) {
    components.push({
      type: 'header',
      parameters: [{ type: 'document', document: { id: document.id, filename: document.filename } }],
    })
  }
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map(value => ({ type: 'text', text: flatten(value).slice(0, 900) || '-' })),
    })
  }
  await graph(`${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
        components,
      },
    }),
  })
}

export async function deliver(opts: {
  to: string
  windowOpen: boolean
  text: string
  buttons?: OutButton[]
  templateName?: string
  templateParams?: string[]
  document?: { id: string; filename: string }
}): Promise<void> {
  if (opts.document) {
    if (opts.windowOpen) {
      await sendDocument(opts.to, opts.document.id, opts.document.filename, opts.text)
    } else {
      await sendTemplate(opts.to, opts.templateName || 'chart_ready', opts.templateParams || [], opts.document)
    }
    return
  }
  if (opts.windowOpen) {
    await sendText(opts.to, opts.text, opts.buttons)
    return
  }
  await sendTemplate(opts.to, opts.templateName || 'duty_update', opts.templateParams?.length ? opts.templateParams : [opts.text])
}

export async function sendDocument(to: string, mediaId: string, filename: string, caption: string): Promise<void> {
  const { phoneId } = graphConfig()
  await graph(`${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { id: mediaId, filename, caption: caption.slice(0, 900) },
    }),
  })
}

export interface TemplateSpec {
  name: string
  body: string
  examples: string[]
  header?: 'DOCUMENT'
  buttons: { text: string }[]
}

/** Utility templates. Button text is what Meta sends back; the bot maps those words. */
export const TEMPLATE_SPECS: TemplateSpec[] = [
  {
    name: 'duty_reminder',
    body: 'Hi {{1}}, you are on night duty on {{2}}. Will you come?',
    examples: ['Asha', '19 Oct'],
    buttons: [{ text: 'Yes' }, { text: 'No' }],
  },
  {
    name: 'availability_request',
    body: 'Hi {{1}}, please reply with the dates you cannot do night duty in {{2}}, or tap the button if every day is fine.',
    examples: ['Asha', '2026-11'],
    buttons: [{ text: 'Available all days' }],
  },
  {
    name: 'chart_ready',
    header: 'DOCUMENT',
    body: 'Hi {{1}}, the night duty chart for {{2}} is attached. Your dates: {{3}}.',
    examples: ['Asha', '2026-11', '12 Nov, 19 Nov'],
    buttons: [],
  },
  {
    name: 'swap_request',
    body: 'Hi {{1}}, {{2}} wants to swap duties. They give {{3}} and would take {{4}}. Accept or decline.',
    examples: ['Rahul', 'Asha', '12 Nov', '19 Nov'],
    buttons: [{ text: 'Accept' }, { text: 'Decline' }],
  },
  {
    name: 'cover_request',
    body: 'Hi {{1}}, can you cover night duty on {{2}} for {{3}}?',
    examples: ['Rahul', '12 Nov', 'Asha'],
    buttons: [{ text: 'Yes' }, { text: 'No' }],
  },
  {
    name: 'attendance_check',
    body: 'Who came for night duty on {{1}}? First: {{2}}. Second: {{3}}.',
    examples: ['19 Oct', 'Asha', 'Rahul'],
    buttons: [
      { text: 'Both' },
      { text: 'Only first' },
      { text: 'Only second' },
      { text: 'Neither' },
    ],
  },
  {
    name: 'duty_update',
    body: 'Night duty update: {{1}}',
    examples: ['Asha said they will come on 19 Oct.'],
    buttons: [],
  },
]

export function templatePayload(spec: TemplateSpec, sampleDocument?: string) {
  const components: Record<string, unknown>[] = []
  if (spec.header === 'DOCUMENT') {
    components.push({
      type: 'HEADER',
      format: 'DOCUMENT',
      example: sampleDocument ? { header_handle: [sampleDocument] } : undefined,
    })
  }
  components.push({
    type: 'BODY',
    text: spec.body,
    example: { body_text: [spec.examples] },
  })
  if (spec.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: spec.buttons.map(button => ({ type: 'QUICK_REPLY', text: button.text })),
    })
  }
  return {
    name: spec.name,
    language: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
    category: 'UTILITY',
    components,
  }
}
