import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

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

interface VideoPlayerProps {
  video: Video;
  onClose: () => void;
  onDownload: () => void;
}

export default function VideoPlayer({ video, onClose, onDownload }: VideoPlayerProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    // In production, you would initialize Video.js here
    // For now, we'll use the native video element
    if (videoRef.current && video.providerVideoUrl) {
      videoRef.current.src = video.providerVideoUrl;
      // Set poster if thumbnail is available
      if (video.thumbnail) {
        videoRef.current.poster = video.thumbnail;
      }
    }
  }, [video.providerVideoUrl, video.thumbnail]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50" data-testid="modal-video-player">
      <div className="relative w-full max-w-4xl mx-4" ref={modalRef}>
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors"
          data-testid="button-close-player"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        <div className="bg-card rounded-lg overflow-hidden">
          {video.providerVideoUrl ? (
            <video
              ref={videoRef}
              className="w-full h-auto max-h-[70vh]"
              controls
              autoPlay
              poster={video.thumbnail}
              data-testid="video-player"
            >
              <source src={video.providerVideoUrl} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          ) : (
            <div className="w-full h-96 bg-muted flex items-center justify-center">
              <div className="text-center">
                <svg className="w-16 h-16 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p className="text-muted-foreground">Video not available</p>
              </div>
            </div>
          )}
          
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 mr-4">
                <h2 className="text-xl font-semibold mb-2" data-testid="text-player-title">
                  {video.title || `Video #${video.taskId.slice(-8)}`}
                </h2>
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Prompt utilizado</h3>
                  <p className="text-sm" data-testid="text-player-prompt">
                    {video.prompt}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={onDownload}
                  className="bg-primary hover:bg-primary/90"
                  data-testid="button-download-player"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigator.share?.({ 
                    title: `AI Generated Video`, 
                    text: video.prompt,
                    url: window.location.href 
                  })}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                  </svg>
                  Share
                </Button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {video.resolution && (
                <div>
                  <span className="text-muted-foreground block">Resolución</span>
                  <span className="font-medium" data-testid="text-player-resolution">{video.resolution}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground block">Fecha de creación</span>
                <span className="font-medium" data-testid="text-player-created">{formatDate(video.createdAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Duración</span>
                <span className="font-medium">8 segundos</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
