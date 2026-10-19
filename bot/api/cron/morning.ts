import { istDate } from '../_lib/pure.js'
import { runMorning } from '../_lib/jobs.js'

export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 })
  const date = new URL(request.url).searchParams.get('date')
  const today = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istDate()
  try {
    const result = await runMorning(today, !date)
    return Response.json({ ...result, date: today })
  } catch (error) {
    console.error('morning failed', error)
    return Response.json({ ok: false }, { status: 500 })
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`
}
