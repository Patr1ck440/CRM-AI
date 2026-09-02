"use client"

import { useMemo, useState, useTransition } from "react"
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { changeStageAction } from "@/server/actions/deals"
import { type Deal, type DealStage, DEAL_STAGES, STAGE_LABEL } from "@/lib/types"
import { canTransition } from "@/lib/validation/schemas"
import { formatRON } from "@/lib/money"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

type BoardDeal = Pick<Deal, "id" | "title" | "value_ron" | "stage"> & {
  client_name: string | null
}

const COLUMNS = DEAL_STAGES

function DealCard({ deal }: { deal: BoardDeal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`cursor-grab touch-none border-border bg-card p-3 active:cursor-grabbing ${
        isDragging ? "opacity-70 shadow-lg" : ""
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight text-card-foreground">{deal.title}</p>
        <Link
          href={`/dashboard/deals/${deal.id}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline"
        >
          Vezi
        </Link>
      </div>
      {deal.client_name ? (
        <p className="mt-1 text-xs text-muted-foreground">{deal.client_name}</p>
      ) : null}
      <p className="mt-2 text-sm font-semibold text-foreground">{formatRON(deal.value_ron)}</p>
    </Card>
  )
}

function Column({
  stage,
  label,
  deals,
}: {
  stage: DealStage
  label: string
  deals: BoardDeal[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const total = deals.reduce((sum, d) => sum + Number.parseFloat(d.value_ron || "0"), 0)

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <Badge variant="secondary">{deals.length}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">{formatRON(total)}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-[60vh] flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors ${
          isOver ? "border-primary bg-primary/5" : "border-border bg-muted/30"
        }`}
      >
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
        {deals.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nicio oportunitate</p>
        ) : null}
      </div>
    </div>
  )
}

export function KanbanBoard({ initialDeals }: { initialDeals: BoardDeal[] }) {
  const router = useRouter()
  const [deals, setDeals] = useState<BoardDeal[]>(initialDeals)
  const [, startTransition] = useTransition()
  const [lostTarget, setLostTarget] = useState<string | null>(null)
  const [lostReason, setLostReason] = useState("")
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const grouped = useMemo(() => {
    const map: Record<DealStage, BoardDeal[]> = {
      lead: [],
      contacted: [],
      offer_sent: [],
      won: [],
      lost: [],
    }
    for (const d of deals) map[d.stage].push(d)
    return map
  }, [deals])

  function commitStage(dealId: string, toStage: DealStage, reason?: string) {
    const previous = deals
    setDeals((curr) => curr.map((d) => (d.id === dealId ? { ...d, stage: toStage } : d)))
    startTransition(async () => {
      const res = await changeStageAction({
        deal_id: dealId,
        to_stage: toStage,
        lost_reason: reason,
      })
      if (!res.ok) {
        setDeals(previous)
        toast.error(res.error)
      } else {
        toast.success("Etapă actualizată")
        router.refresh()
      }
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id)
    const overId = event.over?.id as DealStage | undefined
    if (!overId) return
    const deal = deals.find((d) => d.id === dealId)
    if (!deal || deal.stage === overId) return

    // Oglindim regulile trigger-ului din DB, ca sa nu facem un update optimist
    // care oricum ar fi respins de server.
    if (!canTransition(deal.stage, overId)) {
      toast.error(`Nu se poate muta din „${STAGE_LABEL[deal.stage]}” în „${STAGE_LABEL[overId]}”`)
      return
    }

    if (overId === "lost") {
      setLostTarget(dealId)
      setLostReason("")
      return
    }
    commitStage(dealId, overId)
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <Column key={col.value} stage={col.value} label={col.label} deals={grouped[col.value]} />
          ))}
        </div>
      </DndContext>

      <Dialog open={lostTarget !== null} onOpenChange={(o) => !o && setLostTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Motivul pierderii</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lost-reason">De ce a fost pierdută oportunitatea?</Label>
            <Textarea
              id="lost-reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Preț prea mare, a ales un competitor..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostTarget(null)}>
              Anulează
            </Button>
            <Button
              onClick={() => {
                if (lostReason.trim().length < 3) {
                  toast.error("Te rugăm să specifici un motiv")
                  return
                }
                if (lostTarget) commitStage(lostTarget, "lost", lostReason.trim())
                setLostTarget(null)
              }}
            >
              Confirmă
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
