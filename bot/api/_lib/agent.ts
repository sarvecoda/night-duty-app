import type { OutButton } from './whatsapp.js'
import type { ChatTurn, Pending } from './roster.js'
import { dutiesFor, getAvailability, openRequestsFor } from './roster.js'
import { definitionsFor, definitionsForWeb, runTool, type Caller, type ToolResult } from './tools.js'
import { nextMonthYear, prettyDate, scrubDigits } from './pure.js'

const REFUSAL = 'I can help with your dates, availability, swaps, or telling the admins you can\'t come.'
export const WEB_REFUSAL = 'I can only answer questions about this night-duty roster.'

interface ChatMessage {
  role: string
  content?: string | null
  tool_calls?: unknown
  tool_call_id?: string
}

export interface Answer {
  text: string
  buttons?: OutButton[]
  pending?: Pending | null
  counted?: boolean
}

export async function answer(caller: Caller, text: string, history: ChatTurn[], scope: 'whatsapp' | 'web' = 'whatsapp'): Promise<Answer> {
  if (!process.env.GROQ_API_KEY) {
    return { text: 'The assistant is not set up yet.', counted: false }
  }
  const web = scope === 'web'
  const admin = web || caller.saint.isAdmin === true
  const model = admin
    ? process.env.GROQ_MODEL_ADMIN || 'openai/gpt-oss-120b'
    : process.env.GROQ_MODEL_MEMBER || 'openai/gpt-oss-20b'
  const messages: ChatMessage[] = [
    { role: 'system', content: web ? webPrompt(caller.today) : await systemPrompt(caller) },
    ...history.slice(-8).map(turn => ({ role: turn.role, content: turn.content.slice(0, 500) })),
    { role: 'user', content: text.slice(0, 1000) },
  ]
  const tools = web ? definitionsForWeb() : definitionsFor(caller.saint.isAdmin === true)

  for (let round = 0; round < 4; round++) {
    const response = await groq({
      model,
      temperature: 0,
      max_completion_tokens: 800,
      reasoning_effort: 'low',
      messages,
      tools,
      tool_choice: 'auto',
    })
    if (response.status === 429) {
      return { text: 'I am busy right now. Please send that again in a few minutes.', counted: false }
    }
    if (!response.ok) {
      const errText = await response.text()
      const recovered = await recoverFailedTool(errText, caller, scope, admin)
      if (recovered) {
        messages.push(recovered.assistant, recovered.tool)
        continue
      }
      console.error('groq failed', response.status, errText.slice(0, 300))
      return { text: 'I could not answer that just now. Please try again.', counted: false }
    }
    const body = await response.json() as { choices?: { message?: ChatMessage }[] }
    const message = body.choices?.[0]?.message
    if (!message) return { text: 'I could not answer that just now. Please try again.', counted: false }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls as { id: string; function: { name: string; arguments: string | Record<string, unknown> } }[] : []
    if (!calls.length) {
      return finish(caller, message.content || (web ? WEB_REFUSAL : admin ? 'I could not find that.' : REFUSAL), undefined, undefined, web)
    }
    messages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls })
    let direct: ToolResult | null = null
    for (const call of calls) {
      const rawArgs = typeof call.function.arguments === 'string'
        ? call.function.arguments || '{}'
        : JSON.stringify(call.function.arguments || {})
      const result = await runTool(caller, call.function.name, rawArgs, scope)
      if (result.direct || result.buttons) direct = result
      const shown = result.direct || result.error || JSON.stringify(result.data ?? '')
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: admin ? shown : scrubDigits(shown),
      })
    }
    if (direct?.direct) return finish(caller, direct.direct, direct.buttons, direct.pending, web)
  }
  return finish(caller, web ? WEB_REFUSAL : admin ? 'I could not finish that.' : REFUSAL, undefined, undefined, web)
}

async function recoverFailedTool(errText: string, caller: Caller, scope: 'whatsapp' | 'web', admin: boolean) {
  try {
    const parsed = JSON.parse(errText) as { error?: { failed_generation?: string } }
    const raw = parsed.error?.failed_generation
    if (!raw) return null
    const call = JSON.parse(raw) as { name?: string; arguments?: unknown }
    if (!call.name) return null
    const args = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {})
    const result = await runTool(caller, call.name, args, scope)
    const shown = result.direct || result.error || JSON.stringify(result.data ?? '')
    return {
      assistant: {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'recovered', type: 'function', function: { name: call.name, arguments: args } }],
      },
      tool: { role: 'tool', tool_call_id: 'recovered', content: admin ? shown : scrubDigits(shown) },
    }
  } catch {
    return null
  }
}

function webPrompt(today: string): string {
  return [
    'You answer questions about this night-duty roster only.',
    `Today is ${today} (IST).`,
    'Questions about duty, saints, phone numbers, attendance, availability, and the chart are roster questions. Call a tool before answering them.',
    'Call get_chart for who is on duty. Never say the roster is unavailable.',
    'Never invent names, dates, or phone numbers.',
    'You cannot change the roster or send WhatsApp messages.',
    `For a question that is not about this roster, such as general knowledge, reply exactly: ${WEB_REFUSAL}`,
  ].join('\n')
}

function finish(caller: Caller, text: string, buttons?: OutButton[], pending?: Pending | null, web = false): Answer {
  const clean = web || caller.saint.isAdmin ? text : scrubDigits(text)
  return { text: clean, buttons, pending }
}

async function systemPrompt(caller: Caller): Promise<string> {
  const months = [caller.today.slice(0, 7), nextMonthYear(caller.today.slice(0, 7))]
  const duties = await dutiesFor(caller.saint.id, months)
  const next = nextMonthYear(caller.today.slice(0, 7))
  const availability = await getAvailability(caller.saint.id, next)
  const open = await openRequestsFor(caller.saint.id)
  const dutyLine = duties.length
    ? duties.map(duty => `${prettyDate(duty.date)} with ${duty.partners.join(', ') || 'nobody yet'}`).join('; ')
    : 'none on the current or next chart'
  const availabilityLine = availability
    ? [
      ...(availability.unavailableDates || []).map(prettyDate),
      ...(availability.unavailableDays || []),
    ].join(', ') || 'available with no restrictions'
    : 'not sent yet'
  const requestLine = open.length
    ? open.map(request => `${request.status} ${request.kind} from ${request.fromName} to ${request.toName} on ${prettyDate(request.fromDate)}`).join('; ')
    : 'none'
  const role = caller.saint.isAdmin
    ? 'This person is an admin and may ask about the chart, phone numbers, attendance, and who has not replied.'
    : `This person is a member. For anything outside their dates, availability, swaps, or telling the admins they cannot come, reply exactly: ${REFUSAL}`
  return [
    'You are the night-duty assistant. Change the roster only by calling tools.',
    `Today is ${caller.today} (IST). You are speaking with ${caller.saint.name}.`,
    role,
    'Never invent names, dates, or phone numbers. Never say something was saved unless the tool result says so.',
    'A swap or cover must go through the tool so the exact person can be confirmed before anyone else is messaged.',
    `Their duties: ${dutyLine}.`,
    `Their ${next} availability: ${availabilityLine}.`,
    `Open requests: ${requestLine}.`,
  ].join('\n')
}

async function groq(body: unknown): Promise<Response> {
  const key = process.env.GROQ_API_KEY || ''
  let response: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    })
    if (response.status !== 429) return response
    const wait = Math.min(Number(response.headers.get('retry-after') || '2') || 2, 20)
    await new Promise(resolve => setTimeout(resolve, wait * 1000))
  }
  return response as Response
}
