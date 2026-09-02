"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { acceptInvitationAction } from "@/server/actions/auth"
import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

function AcceptInviteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token") ?? ""

  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => setHasSession(Boolean(user)))
  }, [])

  async function acceptNow() {
    const result = await acceptInvitationAction(token)
    if (!result.ok) {
      toast.error(result.error)
      return false
    }
    const supabase = createClient()
    await supabase.auth.refreshSession()
    toast.success("Invitația a fost acceptată.")
    router.push("/dashboard")
    router.refresh()
    return true
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ??
          `${window.location.origin}/auth/callback?next=${encodeURIComponent(
            `/accept-invite?token=${token}`,
          )}`,
        data: { full_name: fullName },
      },
    })
    setLoading(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success("Verificați-vă emailul pentru a confirma contul, apoi reveniți la acest link.")
  }

  async function handleAcceptExisting() {
    setLoading(true)
    await acceptNow()
    setLoading(false)
  }

  if (!token) {
    return (
      <AuthShell title="Invitație invalidă" subtitle="Linkul de invitație lipsește sau este incomplet." />
    )
  }

  if (hasSession === null) {
    return <AuthShell title="Se încarcă..." />
  }

  if (hasSession) {
    return (
      <AuthShell title="Acceptați invitația" subtitle="Sunteți autentificat. Alăturați-vă organizației.">
        <Button className="w-full" onClick={handleAcceptExisting} disabled={loading}>
          {loading ? "Se procesează..." : "Acceptă și intră în organizație"}
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Acceptați invitația"
      subtitle="Creați-vă contul cu adresa de email la care ați primit invitația."
    >
      <form onSubmit={handleSignUp} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName">Numele dumneavoastră</Label>
          <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email (cel invitat)</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Parolă</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minim 8 caractere"
          />
        </div>
        <Button type="submit" className="mt-2 w-full" disabled={loading}>
          {loading ? "Se creează..." : "Creați contul"}
        </Button>
      </form>
    </AuthShell>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<AuthShell title="Se încarcă..." />}>
      <AcceptInviteInner />
    </Suspense>
  )
}
