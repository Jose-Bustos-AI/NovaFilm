import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';

interface UserProfile {
  creditsRemaining: number;
}

export function CreditsIndicator() {
  const [, navigate] = useLocation();
  
  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['/api/account/me'],
    refetchInterval: 60000 // Update every minute
  });

  if (isLoading || !profile) {
    return (
      <div className="h-8 w-24 bg-muted/50 rounded animate-pulse" />
    );
  }

  const isLowCredits = profile.creditsRemaining <= 2;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigate('/account')}
      className={`flex items-center gap-2 ${
        isLowCredits ? 'border-orange-500 text-orange-600 hover:bg-orange-50' : ''
      }`}
      data-testid="button-credits-indicator"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
      </svg>
      <span data-testid="text-credits-count">{profile.creditsRemaining}</span>
      <span className="text-xs text-muted-foreground">créditos</span>
      {isLowCredits && (
        <Badge variant="destructive" className="text-xs px-1">
          ¡Pocos!
        </Badge>
      )}
    </Button>
  );
}