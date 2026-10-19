import { FormEvent, useState } from 'react'
import { auth } from '../config/firebase'
import './Ask.css'

const BOT_URL = import.meta.env.VITE_BOT_URL || 'https://night-duty-bot.vercel.app'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

function AskConversation() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (!message || busy) return
    const history = turns.slice(-8)
    setText('')
    setError('')
    setTurns(current => [...current, { role: 'user', content: message }])
    setBusy(true)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Sign in again.')
      const response = await fetch(`${BOT_URL}/api/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, history }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 429) {
        setError(typeof data.error === 'string' ? data.error : 'I am busy right now. Please try again in a few minutes.')
        return
      }
      if (!response.ok || typeof data.reply !== 'string') {
        throw new Error(typeof data.error === 'string' ? data.error : 'I could not answer that just now.')
      }
      setTurns(current => [...current, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not answer that just now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="ask-thread" aria-live="polite">
        {turns.length === 0 && (
          <p className="ask-empty">Ask who is on duty, who has not replied, or for someone's phone number.</p>
        )}
        {turns.map((turn, index) => (
          <div key={`${turn.role}-${index}`} className={`ask-bubble ${turn.role}`}>
            {turn.content}
          </div>
        ))}
        {busy && <div className="ask-bubble assistant">Looking that up...</div>}
      </div>
      {error && <p className="ask-error">{error}</p>}
      <form className="ask-form" onSubmit={send}>
        <input
          className="input"
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder="Ask about the roster"
          maxLength={1000}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </>
  )
}

export function AskWidget() {
  const [open, setOpen] = useState(false)

  return (
    <div className="ask-widget">
      {open && (
        <section className="ask-panel" aria-label="Roster chat">
          <div className="ask-panel-header">
            <strong>Ask</strong>
            <button type="button" className="ask-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <AskConversation />
        </section>
      )}
      <button type="button" className="ask-fab" onClick={() => setOpen(current => !current)}>
        Ask
      </button>
    </div>
  )
}

function Ask() {
  return (
    <div className="container ask-page">
      <div className="ask-header">
        <h1>Ask</h1>
        <p>Questions about this night-duty roster.</p>
      </div>
      <AskConversation />
    </div>
  )
}

export default Ask
