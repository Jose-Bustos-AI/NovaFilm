import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Job {
  id: string;
  taskId: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  errorReason?: string;
  createdAt: string;
  video?: {
    prompt: string;
    resolution?: string;
  };
}

interface JobStatusProps {
  jobs: Job[];
  isLoading: boolean;
}

export default function JobStatus({ jobs, isLoading }: JobStatusProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'QUEUED':
        return 'bg-blue-500/10 text-blue-400';
      case 'PROCESSING':
        return 'bg-amber-500/10 text-amber-400';
      case 'READY':
        return 'bg-emerald-500/10 text-emerald-400';
      case 'FAILED':
        return 'bg-destructive/10 text-destructive';
      default:
        return 'bg-muted/10 text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'QUEUED':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'PROCESSING':
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'READY':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'FAILED':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  const activeJobs = jobs.filter(job => job.status === 'PROCESSING' || job.status === 'QUEUED').slice(0, 5);
  const recentCompletedJobs = jobs.filter(job => job.status === 'READY' || job.status === 'FAILED').slice(0, 3);
  const displayJobs = [...activeJobs, ...recentCompletedJobs].slice(0, 6);

  return (
    <Card className="h-[500px] flex flex-col">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Active Jobs
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Track your video generation progress
        </p>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="border border-border rounded-lg p-4 animate-pulse">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded-lg"></div>
                    <div>
                      <div className="h-4 bg-muted rounded w-24 mb-1"></div>
                      <div className="h-3 bg-muted rounded w-32"></div>
                    </div>
                  </div>
                  <div className="h-5 bg-muted rounded w-16"></div>
                </div>
                <div className="h-3 bg-muted rounded w-full"></div>
              </div>
            ))}
          </div>
        ) : displayJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg className="w-12 h-12 text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="text-lg font-medium mb-2">No active jobs</h3>
            <p className="text-muted-foreground">
              Start a conversation with the AI assistant to create your first video
            </p>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto h-full">
            {displayJobs.map((job) => (
              <div
                key={job.id}
                className={`border rounded-lg p-4 ${
                  job.status === 'FAILED' ? 'border-destructive/20 bg-destructive/5' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      job.status === 'READY' 
                        ? 'bg-emerald-500/20' 
                        : job.status === 'FAILED'
                        ? 'bg-destructive/20'
                        : 'bg-gradient-to-br from-primary to-emerald-400'
                    }`}>
                      {getStatusIcon(job.status)}
                    </div>
                    <div>
                      <h3 className="font-medium text-sm">
                        Video Generation
                      </h3>
                      <p className="text-xs text-muted-foreground font-mono">
                        {job.taskId}
                      </p>
                    </div>
                  </div>
                  <Badge className={getStatusColor(job.status)}>
                    {job.status.charAt(0) + job.status.slice(1).toLowerCase()}
                  </Badge>
                </div>
                
                {job.video?.prompt && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {job.video.prompt}
                  </p>
                )}
                
                {job.errorReason && (
                  <p className="text-xs text-destructive mb-2">
                    {job.errorReason}
                  </p>
                )}
                
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatTimeAgo(job.createdAt)}</span>
                  {job.status === 'READY' && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
                      View Video
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
