import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Gallery from "@/pages/gallery";
import { AccountPage } from "@/pages/AccountPage";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  // Debug logging for problematic routes  
  useEffect(() => {
    if (location && !['/', '/gallery', '/account'].includes(location)) {
      console.warn('❌ Unknown route accessed:', location);
      console.trace('Route access stack trace:');
    }
  }, [location]);

  // Monitor scroll events that might trigger navigation
  useEffect(() => {
    const handleScroll = (event: Event) => {
      // Log any scroll events that happen when we're at an unknown route
      if (location && !['/', '/gallery', '/account'].includes(location)) {
        console.warn('❌ Scroll event during unknown route:', location, event.target);
      }
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [location]);

  // Show loading state during authentication check
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      {!isAuthenticated ? (
        <>
          <Route path="/" component={Landing} />
          <Route component={Landing} />
        </>
      ) : (
        <>
          <Route path="/" component={Dashboard} />
          <Route path="/gallery" component={Gallery} />
          <Route path="/account" component={AccountPage} />
          <Route component={NotFound} />
        </>
      )}
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Toaster />
          <Router />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
