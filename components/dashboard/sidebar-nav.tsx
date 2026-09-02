"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Users,
  Target,
  KanbanSquare,
  Building2,
  UsersRound,
  Mail,
  ShieldCheck,
  FileText,
  Sparkles,
} from "lucide-react"
import type { AppRole } from "@/lib/types"

type NavItem = { href: string; label: string; icon: React.ElementType; adminOnly?: boolean }

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Panou", icon: LayoutDashboard },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/dashboard/deals", label: "Oportunități", icon: Target },
  { href: "/dashboard/clients", label: "Clienți", icon: Building2 },
  { href: "/dashboard/documents", label: "Documente", icon: FileText },
  { href: "/dashboard/ai-documents", label: "Documente AI", icon: Sparkles },
]

const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard/admin/users", label: "Utilizatori", icon: Users, adminOnly: true },
  { href: "/dashboard/admin/teams", label: "Echipe", icon: UsersRound, adminOnly: true },
  { href: "/dashboard/admin/invitations", label: "Invitații", icon: Mail, adminOnly: true },
]

export function SidebarNav({ role }: { role: AppRole }) {
  const pathname = usePathname()

  const renderItem = ({ href, label, icon: Icon }: NavItem) => {
    const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" />
        {label}
      </Link>
    )
  }

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Navigație principală">
      {NAV.map(renderItem)}
      {role === "admin" && (
        <>
          <div className="mt-4 mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Administrare
          </div>
          {ADMIN_NAV.map(renderItem)}
        </>
      )}
    </nav>
  )
}
