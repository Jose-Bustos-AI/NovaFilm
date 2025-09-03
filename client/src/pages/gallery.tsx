import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/sidebar";
import VideoGallery from "@/components/video-gallery";
import { useQuery } from "@tanstack/react-query";

export default function Gallery() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: videos = [], isLoading: videosLoading } = useQuery<any[]>({
    queryKey: ["/api/videos"],
    enabled: isAuthenticated,
    refetchInterval: 30000, // Poll every 30 seconds
  });

  if (isLoading || !isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <div className="flex-1 ml-64">
        {/* Header */}
        <header className="bg-card border-b border-border px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-gallery-title">Video Gallery</h1>
              <p className="text-muted-foreground">Browse and manage your AI-generated videos</p>
            </div>
            <div className="text-sm text-muted-foreground">
              {videos.length} {videos.length === 1 ? 'video' : 'videos'} total
            </div>
          </div>
        </header>

        <main className="p-8">
          <VideoGallery videos={videos as any[]} isLoading={videosLoading} showAllVideos />
        </main>
      </div>
    </div>
  );
}
