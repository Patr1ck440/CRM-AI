import { listDocumentsAction } from "@/server/actions/documents"
import { createClient } from "@/lib/supabase/server"
import { getTenantContext } from "@/lib/guards"
import { DocumentUploadForm } from "@/components/dashboard/document-upload-form"
import { DocumentRowActions } from "@/components/dashboard/document-row-actions"
import { DocumentActions } from "@/components/dashboard/document-actions"

const INGEST_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "În așteptare", className: "bg-muted text-muted-foreground" },
  processing: { label: "Se procesează", className: "bg-blue-500/10 text-blue-600" },
  done: { label: "Indexat", className: "bg-green-500/10 text-green-600" },
  failed: { label: "Eșuat", className: "bg-red-500/10 text-red-600" },
}

function IngestStatusBadge({ status }: { status: string }) {
  const meta = INGEST_STATUS[status] ?? INGEST_STATUS.pending
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  )
}

export default async function DocumentsPage() {
  const result = await listDocumentsAction()
  const ctx = await getTenantContext()
  const supabase = await createClient()

const { data: deals } = await supabase
  .from("deals")
  .select("id, title")
  .order("title")

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name")

  if (!result.ok) {
    return <p className="text-red-500">Eroare: {result.error}</p>
  }

  const documents = result.data

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Documente</h1>
      </div>

      <DocumentUploadForm clients={clients ?? []} deals={deals ?? []} />

      {documents.length === 0 ? (
        <p className="text-muted-foreground">Nu există documente încă.</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Nume fișier</th>
                <th className="p-3 text-left font-medium">Tip</th>
                <th className="p-3 text-left font-medium">Mărime</th>
                <th className="p-3 text-left font-medium">Data</th>
                <th className="p-3 text-left font-medium">Indexare AI</th>
                <th className="p-3 text-left font-medium">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">{doc.file_name}</td>
                  <td className="p-3 text-muted-foreground">{doc.mime_type}</td>
                  <td className="p-3 text-muted-foreground">
                    {(doc.file_size / 1024).toFixed(1)} KB
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(doc.created_at).toLocaleDateString("ro-RO")}
                  </td>
                  <td className="p-3">
                    <IngestStatusBadge status={doc.ingest_status} />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <DocumentActions documentId={doc.id} />
                      <DocumentRowActions documentId={doc.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}