import type { OutButton } from './whatsapp.ts'
import type { ChatTurn, Pending } from './roster.ts'
import { dutiesFor, getAvailability, openRequestsFor } from './roster.ts'
import { definitionsFor, runTool, type Caller, type ToolResult } from './tools.ts'
import { nextMonthYear, prettyDate, scrubDigits } from './pure.ts'

const REFUSAL = 'I can help with your dates, availability, swaps, or telling the admins you can\'t come.'

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

export async function answer(caller: Caller, text: string, history: ChatTurn[]): Promise<Answer> {
  if (!process.env.GROQ_API_KEY) {
    return { text: 'The assistant is not set up yet.', counted: false }
  }
  const admin = caller.saint.isAdmin === true
  const model = admin
    ? process.env.GROQ_MODEL_ADMIN || 'openai/gpt-oss-120b'
    : process.env.GROQ_MODEL_MEMBER || 'openai/gpt-oss-20b'
  const messages: ChatMessage[] = [
    { role: 'system', content: await systemPrompt(caller) },
    ...history.slice(-8).map(turn => ({ role: turn.role, content: turn.content.slice(0, 500) })),
    { role: 'user', content: text.slice(0, 1000) },
  ]
  const tools = definitionsFor(admin)

  for (let round = 0; round < 4; round++) {
    const last = round === 3
    const response = await groq({
      model,
      temperature: 0,
      max_completion_tokens: 800,
      reasoning_effort: 'low',
      messages,
      tools: last ? undefined : tools,
    })
    if (response.status === 429) {
      return { text: 'I am busy right now. Please send that again in a few minutes.', counted: false }
    }
    if (!response.ok) {
      console.error('groq failed', response.status, (await response.text()).slice(0, 300))
      return { text: 'I could not answer that just now. Please try again.', counted: false }
    }
    const body = await response.json() as { choices?: { message?: ChatMessage }[] }
    const message = body.choices?.[0]?.message
    if (!message) return { text: 'I could not answer that just now. Please try again.', counted: false }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls as { id: string; function: { name: string; arguments: string | Record<string, unknown> } }[] : []
    if (!calls.length || last) {
      return finish(caller, message.content || (admin ? 'I could not find that.' : REFUSAL))
    }
    messages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls })
    let direct: ToolResult | null = null
    for (const call of calls) {
      const rawArgs = typeof call.function.arguments === 'string'
        ? call.function.arguments || '{}'
        : JSON.stringify(call.function.arguments || {})
      const result = await runTool(caller, call.function.name, rawArgs)
      if (result.direct || result.buttons) direct = result
      const shown = result.direct || result.error || JSON.stringify(result.data ?? '')
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: admin ? shown : scrubDigits(shown),
      })
    }
    if (direct?.direct) return finish(caller, direct.direct, direct.buttons, direct.pending)
  }
  return finish(caller, admin ? 'I could not finish that.' : REFUSAL)
}

function finish(caller: Caller, text: string, buttons?: OutButton[], pending?: Pending | null): Answer {
  const clean = caller.saint.isAdmin ? text : scrubDigits(text)
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
