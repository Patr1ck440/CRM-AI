import { notFound } from "next/navigation"
import Link from "next/link"
import { getClientById, getContactsForClient, getDealsForClient, getActivities } from "@/server/data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClientFormDialog } from "@/components/clients/client-form-dialog"
import { ContactFormDialog } from "@/components/clients/contact-form-dialog"
import { DealFormDialog } from "@/components/deals/deal-form-dialog"
import { ActivityComposer } from "@/components/activities/activity-composer"
import { ActivityTimeline } from "@/components/activities/activity-timeline"
import { formatRON } from "@/lib/money"
import { STAGE_LABEL } from "@/lib/types"
import { ArrowLeft, Mail, Phone, Star, Pencil } from "lucide-react"
import { AiDocumentChat } from "@/components/dashboard/ai-document-chat"

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = await getClientById(id)
  if (!client) notFound()

  const [contacts, deals, activities] = await Promise.all([
    getContactsForClient(id),
    getDealsForClient(id),
    getActivities({ clientId: id }),
  ])

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Înapoi la clienți
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            {client.company ?? "—"}
            {client.industry ? ` · ${client.industry}` : ""}
          </p>
        </div>
        <ClientFormDialog
          client={client}
          trigger={
            <Button variant="outline">
              <Pencil className="mr-2 size-4" />
              Editează
            </Button>
          }
        />
      </div>

      {client.notes && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">{client.notes}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="activity" className="w-full">
        <TabsList>
          <TabsTrigger value="activity">Activitate</TabsTrigger>
          <TabsTrigger value="contacts">Contacte ({contacts.length})</TabsTrigger>
          <TabsTrigger value="deals">Oportunități ({deals.length})</TabsTrigger>
          <TabsTrigger value="ai">Documente AI</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="space-y-4">
          <ActivityComposer clientId={id} />
          <Card>
            <CardContent className="p-4">
              <ActivityTimeline activities={activities} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="space-y-4">
          <div className="flex justify-end">
            <ContactFormDialog clientId={id} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {contacts.map((c) => (
              <Card key={c.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{c.full_name}</p>
                    {c.is_primary && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="size-3" /> Principal
                      </Badge>
                    )}
                  </div>
                  {c.position && <p className="text-sm text-muted-foreground">{c.position}</p>}
                  {c.email && (
                    <p className="flex items-center gap-2 text-sm">
                      <Mail className="size-3.5 text-muted-foreground" /> {c.email}
                    </p>
                  )}
                  {c.phone && (
                    <p className="flex items-center gap-2 text-sm">
                      <Phone className="size-3.5 text-muted-foreground" /> {c.phone}
                    </p>
                  )}
                  <div className="pt-1">
                    <ContactFormDialog
                      clientId={id}
                      contact={c}
                      trigger={
                        <Button variant="ghost" size="sm">
                          Editează
                        </Button>
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
            {contacts.length === 0 && (
              <p className="text-sm text-muted-foreground">Niciun contact adăugat.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="deals" className="space-y-3">
          <div className="flex justify-end">
            <DealFormDialog clients={[{ id: client.id, name: client.name }]} defaultClientId={client.id} />
          </div>
          {deals.map((d) => (
            <Link key={d.id} href={`/dashboard/deals/${d.id}`}>
              <Card className="transition-colors hover:border-primary">
                <CardHeader className="flex flex-row items-center justify-between py-4">
                  <CardTitle className="text-base">{d.title}</CardTitle>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">{formatRON(d.value_ron)}</span>
                    <Badge variant="outline">{STAGE_LABEL[d.stage]}</Badge>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
          {deals.length === 0 && <p className="text-sm text-muted-foreground">Nicio oportunitate.</p>}
        </TabsContent>

        <TabsContent value="ai">
          <Card>
            <CardContent className="h-[600px] p-4">
              <AiDocumentChat clientId={id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
