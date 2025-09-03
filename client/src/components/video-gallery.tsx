import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import VideoPlayer from "@/components/video-player";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface Video {
  id: string;
  taskId: string;
  prompt: string;
  title?: string;
  thumbnail?: string;
  providerVideoUrl?: string;
  resolution?: string;
  createdAt: string;
}

interface VideoGalleryProps {
  videos: Video[];
  isLoading: boolean;
  showAllVideos?: boolean;
}

export default function VideoGallery({ videos, isLoading, showAllVideos = false }: VideoGalleryProps) {
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const queryClient = useQueryClient();
  
  // Mutation to update video metadata
  const updateVideoMutation = useMutation({
    mutationFn: async ({ videoId, updates }: { videoId: string; updates: any }) => {
      const response = await apiRequest('PATCH', `/api/videos/${videoId}`, updates);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/videos'] });
    }
  });
  
  // Function to capture thumbnail from video
  const captureThumbnail = async (videoUrl: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Set a timeout to avoid hanging
      const timeout = setTimeout(() => {
        console.log('Thumbnail capture timeout for:', videoUrl);
        resolve(null);
      }, 15000);
      
      // Try without crossOrigin first, as external videos may not support CORS
      video.muted = true;
      video.preload = 'metadata';
      video.playsInline = true;
      
      let metadataLoaded = false;
      let hasTriedSeek = false;
      
      video.onloadedmetadata = () => {
        console.log('Video metadata loaded:', video.videoWidth, 'x', video.videoHeight);
        metadataLoaded = true;
        
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = Math.min(video.videoWidth, 320);
          canvas.height = Math.min(video.videoHeight, 180);
          
          // Try to seek to a frame for thumbnail
          try {
            const seekTime = Math.min(0.5, video.duration * 0.1);
            video.currentTime = seekTime;
            hasTriedSeek = true;
          } catch (e) {
            console.log('Cannot seek video, trying to capture current frame');
            captureFrame();
          }
        } else {
          console.log('Invalid video dimensions');
          clearTimeout(timeout);
          resolve(null);
        }
      };
      
      const captureFrame = () => {
        try {
          if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            console.log('Thumbnail captured successfully, size:', dataUrl.length);
            clearTimeout(timeout);
            resolve(dataUrl);
          } else {
            console.log('Failed to capture: invalid video or context');
            clearTimeout(timeout);
            resolve(null);
          }
        } catch (error) {
          console.log('Error capturing thumbnail:', error);
          clearTimeout(timeout);
          resolve(null);
        }
      };
      
      video.onseeked = () => {
        console.log('Video seeked, capturing frame...');
        captureFrame();
      };
      
      video.oncanplaythrough = () => {
        console.log('Video can play through');
        if (metadataLoaded && !hasTriedSeek) {
          // If we haven't tried seeking yet and video is ready, capture current frame
          captureFrame();
        }
      };
      
      video.onerror = (error) => {
        console.log('Video error:', error);
        clearTimeout(timeout);
        resolve(null);
      };
      
      video.onloadstart = () => {
        console.log('Video load started');
      };
      
      console.log('Starting thumbnail capture for:', videoUrl);
      video.src = videoUrl;
      video.load();
    });
  };
  
  // Auto-generate titles for videos without them (simplified approach)
  useEffect(() => {
    const generateMissingTitles = async () => {
      const videosNeedingTitles = videos.filter(video => 
        video.providerVideoUrl && !video.title
      );
      
      console.log('Videos needing titles:', videosNeedingTitles.length);
      
      if (videosNeedingTitles.length === 0 || updateVideoMutation.isPending) {
        return;
      }
      
      // Process only one video at a time
      for (const video of videosNeedingTitles.slice(0, 1)) {
        console.log('Generating title for video:', video.id);
        try {
          const title = generateVideoTitle(video.prompt);
          console.log('Updating video with title:', { videoId: video.id, title });
          updateVideoMutation.mutate({
            videoId: video.id,
            updates: { title }
          });
          break; // Only process one at a time
        } catch (error) {
          console.log('Error generating title for video:', video.id, error);
        }
      }
    };
    
    // Add a small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      generateMissingTitles();
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [videos, updateVideoMutation.isPending]);
  
  // Generate a user-friendly title from prompt
  const generateVideoTitle = (prompt: string): string => {
    const maxLength = 50;
    if (prompt.length <= maxLength) {
      return `Vídeo: ${prompt}`;
    }
    return `Vídeo: ${prompt.substring(0, maxLength)}...`;
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

  const handleDownload = (video: Video) => {
    if (video.providerVideoUrl) {
      window.open(`/api/videos/${video.id}/download`, '_blank');
    }
  };

  const readyVideos = videos.filter(video => video.providerVideoUrl);
  const displayVideos = showAllVideos ? readyVideos : readyVideos.slice(0, 6);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {showAllVideos ? 'All Videos' : 'Recent Videos'}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {showAllVideos ? 'Browse all your AI-generated content' : 'Your latest AI-generated content'}
              </p>
            </div>
            {!showAllVideos && readyVideos.length > 6 && (
              <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
                View All
                <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Button>
            )}
          </div>
        </CardHeader>
        
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-muted rounded-lg overflow-hidden animate-pulse">
                  <div className="w-full h-48 bg-muted/50"></div>
                  <div className="p-4">
                    <div className="h-4 bg-muted/50 rounded mb-2"></div>
                    <div className="h-3 bg-muted/50 rounded mb-3"></div>
                    <div className="flex justify-between">
                      <div className="h-3 bg-muted/50 rounded w-16"></div>
                      <div className="h-6 bg-muted/50 rounded w-20"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : displayVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-16 h-16 text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <h3 className="text-lg font-medium mb-2">No videos yet</h3>
              <p className="text-muted-foreground mb-4">
                Start creating amazing videos with our AI assistant
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayVideos.map((video) => (
                <div
                  key={video.id}
                  className="bg-muted rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-105 group"
                  onClick={() => setSelectedVideo(video)}
                  data-testid={`card-video-${video.id}`}
                >
                  <div className="relative">
                    {video.thumbnail ? (
                      <img 
                        src={video.thumbnail} 
                        alt={video.title || `Video ${video.taskId.slice(-8)}`}
                        className="w-full h-48 object-cover"
                        onError={(e) => {
                          // Fallback to styled preview if thumbnail fails to load
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`w-full h-48 relative overflow-hidden ${video.thumbnail ? 'hidden' : ''}`}>
                      {/* Dynamic gradient based on video content */}
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/30 via-purple-500/20 to-pink-500/30"></div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                      
                      {/* Content preview */}
                      <div className="relative h-full flex flex-col justify-between p-4">
                        <div className="flex items-center justify-center flex-1">
                          <div className="bg-white/10 backdrop-blur-sm rounded-full p-4">
                            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l.414.414c.187.187.293.442.293.707V13M15 10h-1.586a1 1 0 00-.707.293l-.414.414A1 1 0 0012 11.414V13" />
                            </svg>
                          </div>
                        </div>
                        
                        {/* Mini preview text */}
                        <div className="text-white text-xs opacity-80 line-clamp-2">
                          {video.prompt.substring(0, 80)}...
                        </div>
                      </div>
                    </div>
                    
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l.414.414c.187.187.293.442.293.707V13M15 10h-1.586a1 1 0 00-.707.293l-.414.414A1 1 0 0012 11.414V13" />
                        </svg>
                      </div>
                    </div>
                    
                    {video.resolution && (
                      <div className="absolute top-3 right-3 bg-emerald-500 text-white text-xs px-2 py-1 rounded">
                        {video.resolution}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4">
                    <h3 className="font-medium mb-2 line-clamp-1" data-testid={`text-video-title-${video.id}`}>
                      {video.title || `Video #${video.taskId.slice(-8)}`}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3" data-testid={`text-video-prompt-${video.id}`}>
                      {video.prompt}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground" data-testid={`text-video-time-${video.id}`}>
                        {formatTimeAgo(video.createdAt)}
                      </span>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleDownload(video)}
                          data-testid={`button-download-${video.id}`}
                        >
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Video Player Modal */}
      {selectedVideo && (
        <VideoPlayer
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          onDownload={() => handleDownload(selectedVideo)}
        />
      )}
    </>
  );
}
