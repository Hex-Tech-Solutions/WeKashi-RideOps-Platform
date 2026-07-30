import { ReactNode } from "react";
import { NavLink, useLocation, Link, useNavigate } from "react-router-dom";
import { Bell, LogOut, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

interface RoleLayoutProps {
  role: "Supervisor" | "Vendor" | "Admin";
  user: { name: string; sub: string };
  nav: NavItem[];
  children: ReactNode;
}

export function RoleLayout({ role, user, nav, children }: RoleLayoutProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const displayName = auth.user?.user_metadata?.full_name || auth.user?.email?.split("@")[0] || user.name;
  const displaySub = auth.user?.email || user.sub;
  const initials = (displayName || "U").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    await auth.signOut();
    toast.success("Signed out");
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shrink-0">
        <Link to="/" className="h-16 flex items-center gap-2 px-6 border-b border-sidebar-border">
          <div className="h-8 w-8 rounded-md bg-gradient-gold flex items-center justify-center font-bold text-gold-foreground">R</div>
          <div>
            <div className="font-semibold text-white tracking-tight leading-none">RideOps</div>
            <div className="text-[10px] uppercase tracking-widest text-gold mt-1">{role}</div>
          </div>
        </Link>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-gold font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="text-[10px] font-semibold bg-gold text-gold-foreground rounded-full px-2 py-0.5">{item.badge}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border">
          <button onClick={handleSignOut} className="w-full flex items-center gap-2 text-xs text-sidebar-foreground/60 hover:text-gold px-3 py-2 rounded-md hover:bg-sidebar-accent/40">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-card flex items-center px-6 gap-4 shrink-0">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search rides, drivers, employees..." className="pl-9 bg-secondary border-0 focus-visible:ring-1 focus-visible:ring-gold" />
          </div>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-4 w-4" />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-gold" />
          </Button>
          <div className="flex items-center gap-3 pl-4 border-l border-border">
            <div className="text-right">
              <div className="text-sm font-medium leading-none capitalize">{displayName}</div>
              <div className="text-xs text-muted-foreground mt-1">{displaySub}</div>
            </div>
            <Avatar className="h-9 w-9 bg-foreground text-background">
              <AvatarFallback className="bg-foreground text-background text-xs font-semibold">{initials}</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, accent, icon: Icon }: { label: string; value: string | number; hint?: string; accent?: boolean; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className={cn(
      "group relative overflow-hidden rounded-xl border bg-card p-5 shadow-card transition-all duration-300",
      "hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_hsl(0_0%_0%/0.18)] hover:border-gold/40",
      accent && "border-gold/50 bg-gradient-to-br from-gold-soft to-card"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        {Icon && (
          <div className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
            accent ? "bg-gold text-gold-foreground" : "bg-secondary text-foreground/70 group-hover:bg-gold/15 group-hover:text-gold-dark"
          )}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className={cn("text-3xl font-bold mt-3 tracking-tight tabular-nums", accent && "text-gold-dark")}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1.5">{hint}</div>}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

export function MapPlaceholder({ height = 360, children }: { height?: number; children?: ReactNode }) {
  return (
    <div
      className="relative rounded-lg border overflow-hidden bg-muted"
      style={{
        height,
        backgroundImage:
          "linear-gradient(hsl(0 0% 88%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 88%) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-foreground/5" />
      {children}
    </div>
  );
}
