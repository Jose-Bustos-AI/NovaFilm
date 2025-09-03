import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/sidebar";
import ChatInterface from "@/components/chat-interface";
import JobStatus from "@/components/job-status";
import VideoGallery from "@/components/video-gallery";
import { CreditsIndicator } from "@/components/credits-indicator";
import { useQuery } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function Dashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();

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
    refetchInterval: 20000, // Poll every 20 seconds
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
    refetchInterval: 15000, // Poll every 15 seconds
  });

  // Database health check
  const { data: dbHealth, isError: dbError } = useQuery({
    queryKey: ["/api/health/db"],
    enabled: isAuthenticated,
    refetchInterval: 60000, // Check every minute
    retry: 2,
  });

  if (isLoading || !isAuthenticated) {
    return null;
  }

  // Database error state
  if (dbError || (dbHealth && !(dbHealth as any).ok)) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-md mx-auto text-center p-6">
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="flex items-center gap-2 text-destructive mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="font-medium">Database not configured</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Add DATABASE_URL in Replit Secrets (Neon) to enable video generation.
                </p>
                <div className="text-xs text-muted-foreground bg-muted p-2 rounded font-mono">
                  DATABASE_URL=postgres://user:pass@host/db?sslmode=require
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calculate stats
  const totalVideos = videos.length;
  const processingJobs = jobs.filter((job: any) => job.status === 'PROCESSING').length;
  const readyVideos = videos.filter((video: any) => {
    const job = jobs.find((j: any) => j.taskId === video.taskId);
    return job?.status === 'READY';
  }).length;
  
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <div className="flex-1 ml-64">
        {/* Header */}
        <header className="bg-card border-b border-border px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
              <p className="text-muted-foreground">Manage your AI video generation projects</p>
            </div>
            <div className="flex items-center gap-4">
              <CreditsIndicator />
            </div>
          </div>
        </header>

        <main className="p-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full">
                  Total
                </span>
              </div>
              <h3 className="text-2xl font-bold mb-1" data-testid="text-total-videos">{totalVideos}</h3>
              <p className="text-muted-foreground text-sm">Total Videos</p>
            </div>
            
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-amber-500/10 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-1 rounded-full">
                  {processingJobs} active
                </span>
              </div>
              <h3 className="text-2xl font-bold mb-1" data-testid="text-processing-jobs">{processingJobs}</h3>
              <p className="text-muted-foreground text-sm">Processing</p>
            </div>
            
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </div>
                <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full">
                  Ready
                </span>
              </div>
              <h3 className="text-2xl font-bold mb-1" data-testid="text-ready-videos">{readyVideos}</h3>
              <p className="text-muted-foreground text-sm">Completed</p>
            </div>
            
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">Premium</span>
              </div>
              <h3 className="text-2xl font-bold mb-1">5</h3>
              <p className="text-muted-foreground text-sm">Credits Left</p>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <ChatInterface />
            <JobStatus jobs={jobs as any[]} isLoading={jobsLoading} />
          </div>

          {/* Video Gallery */}
          <VideoGallery videos={videos as any[]} isLoading={videosLoading} />
        </main>
      </div>
    </div>
  );
}
