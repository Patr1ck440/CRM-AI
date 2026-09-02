"use client"

import { useState } from "react"
import { Loader2, Send } from "lucide-react"

type Citation = { id: string; file_name: string; page_number: number | null }
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[] }

type Props = {
  clientId?: string
  dealId?: string
}

export function AiDocumentChat({ clientId, dealId }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasContext = Boolean(clientId || dealId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const question = input.trim()
    setMessages((prev) => [...prev, { role: "user", content: question }])
    setInput("")
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/ai/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          client_id: clientId,
          deal_id: dealId,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Eroare server (${res.status})`)
        return
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, citations: data.citations },
      ])
    } catch {
      setError("Eroare de rețea. Încearcă din nou.")
    } finally {
      setLoading(false)
    }
  }

  if (!hasContext) {
    return (
      <p className="text-sm text-muted-foreground">
        Selectează un client sau un deal pentru a căuta în documentele asociate.
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border p-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Întreabă ceva despre documentele asociate acestui context.
          </p>
        )}
        {messages.map((m, idx) => (
          <div key={idx} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={
                m.role === "user"
                  ? "inline-block rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "inline-block rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
              }
            >
              {m.content}
            </div>
            {m.citations && m.citations.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                {m.citations.map((c) => (
                  <span key={c.id} className="rounded bg-secondary px-2 py-0.5">
                    {c.file_name}
                    {c.page_number ? ` — pag. ${c.page_number}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Întreabă despre documente..."
          className="flex-1 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}