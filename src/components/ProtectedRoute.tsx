import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children, requiredRole }: { children: JSX.Element; requiredRole: AppRole }) {
  const { user, roles, loading, rolesLoading } = useAuth();
  const loc = useLocation();

  // Wait for session restore AND for roles to finish loading for the signed-in user
  if (loading || (user && rolesLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" state={{ from: loc.pathname }} replace />;
  if (!roles.includes(requiredRole)) {
    // Send them to whichever console they actually belong to (or landing)
    const fallback = roles.includes("admin") ? "/admin"
                    : roles.includes("vendor") ? "/vendor"
                    : roles.includes("supervisor") ? "/supervisor" : "/";
    return <Navigate to={fallback} replace />;
  }
  return children;
}
