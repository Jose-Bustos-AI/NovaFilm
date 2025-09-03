import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export default function Sidebar() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  const navigation = [
    { name: 'Dashboard', path: '/', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z' },
    { name: 'Gallery', path: '/gallery', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  ];

  return (
    <div className="fixed left-0 top-0 h-full w-64 bg-card border-r border-border z-40">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-emerald-400 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold">VideoAI</h1>
        </div>
        
        <nav className="space-y-2">
          {navigation.map((item) => {
            const isActive = location === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                }`}
                data-testid={`link-${item.name.toLowerCase()}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>
      </div>
      
      <div className="absolute bottom-6 left-6 right-6">
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-emerald-400 rounded-full flex items-center justify-center text-white text-sm font-medium overflow-hidden">
              {(user as any)?.profileImageUrl ? (
                <img 
                  src={(user as any).profileImageUrl} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{(user as any)?.firstName?.[0] || (user as any)?.email?.[0] || 'U'}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate" data-testid="text-username">
                {(user as any)?.firstName && (user as any)?.lastName 
                  ? `${(user as any).firstName} ${(user as any).lastName}`
                  : (user as any)?.email || 'User'
                }
              </p>
              <p className="text-xs text-muted-foreground truncate" data-testid="text-email">
                {(user as any)?.email || 'user@example.com'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start text-muted-foreground hover:text-foreground px-0"
            data-testid="button-logout"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
