import type { ReactNode } from "react"
import Link from "next/link"
import { Sparkles } from "lucide-react"
import { getTenantContext } from "@/lib/guards"
import { createClient } from "@/lib/supabase/server"
import { SidebarNav } from "@/components/dashboard/sidebar-nav"
import { UserMenu } from "@/components/dashboard/user-menu"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet"
import { buttonVariants } from "@/components/ui/button"
import { Menu } from "lucide-react"
import { cn } from "@/lib/utils"

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getTenantContext()
  const supabase = await createClient()
  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", ctx.tenantId).maybeSingle()
  const tenantName = tenant?.name ?? "CRM"

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 px-4 py-4">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Sparkles className="size-4" />
      </div>
      <span className="text-base font-semibold tracking-tight">Nimbus CRM</span>
    </Link>
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        {brand}
        <SidebarNav role={ctx.role} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger
                aria-label="Deschide meniul"
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "lg:hidden")}
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetTitle className="sr-only">Navigație</SheetTitle>
                {brand}
                <SidebarNav role={ctx.role} />
              </SheetContent>
            </Sheet>
            <span className="text-sm text-muted-foreground">{tenantName}</span>
          </div>
          <UserMenu fullName={ctx.fullName} email={ctx.email} role={ctx.role} tenantName={tenantName} />
        </header>

        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
