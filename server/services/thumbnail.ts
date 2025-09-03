import { storage } from '../storage';
import { spawn } from 'child_process';
import { createWriteStream, unlinkSync, readFile } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Simple placeholder service for thumbnail generation
// In a production app, this would use FFmpeg or a similar tool
export class ThumbnailService {
  
  /**
   * Generate thumbnail for a video by extracting frame
   * Uses video URL to create a data URL thumbnail
   */
  async generateThumbnail(videoUrl: string, taskId: string): Promise<string | null> {
    try {
      console.log(`[THUMBNAIL] Generating thumbnail for video: ${taskId}`);
      
      // Check if thumbnail already exists (idempotency)
      const existingVideo = await storage.getVideoByTaskId(taskId);
      if (existingVideo?.thumbnail) {
        console.log(`[THUMBNAIL] Thumbnail already exists for ${taskId}: ${existingVideo.thumbnail.substring(0, 50)}...`);
        return existingVideo.thumbnail;
      }
      
      // Try to extract real frame from video first
      const realThumbnail = await this.extractFrameFromVideo(videoUrl, taskId);
      if (realThumbnail) {
        console.log(`[THUMBNAIL] Generated real frame thumbnail for ${taskId}`);
        return realThumbnail;
      }
      
      // Fallback to placeholder if frame extraction fails
      const placeholderThumbnail = this.generatePlaceholderThumbnail(taskId);
      console.log(`[THUMBNAIL] Generated placeholder thumbnail for ${taskId}`);
      return placeholderThumbnail;
      
    } catch (error) {
      console.error(`[THUMBNAIL] Error generating thumbnail for ${taskId}:`, error);
      return null;
    }
  }
  
  /**
   * Extract frame from video URL using ffmpeg
   */
  private async extractFrameFromVideo(videoUrl: string, taskId: string): Promise<string | null> {
    try {
      console.log(`[THUMBNAIL] Extracting frame from video URL: ${videoUrl}`);
      
      // Create temporary file paths
      const tempId = Date.now().toString() + Math.random().toString(36).substring(7);
      const tempVideoPath = join(tmpdir(), `video_${tempId}.mp4`);
      const tempImagePath = join(tmpdir(), `thumb_${tempId}.jpg`);
      
      try {
        // Download video to temp file first
        console.log(`[THUMBNAIL] Downloading video for ${taskId}...`);
        const response = await fetch(videoUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch video: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Write video to temp file
        await new Promise<void>((resolve, reject) => {
          const writeStream = createWriteStream(tempVideoPath);
          writeStream.write(buffer);
          writeStream.end();
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
        
        console.log(`[THUMBNAIL] Extracting frame from ${taskId}...`);
        
        // Extract frame at 1 second using ffmpeg
        const thumbnailBase64 = await new Promise<string>((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', [
            '-i', tempVideoPath,
            '-ss', '1', // Extract frame at 1 second
            '-vframes', '1', // Extract only 1 frame
            '-f', 'image2',
            '-vf', 'scale=320:180', // Resize to standard thumbnail size
            '-q:v', '2', // High quality
            '-y', // Overwrite output file
            tempImagePath
          ]);
          
          let stderr = '';
          ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
          });
          
          ffmpeg.on('close', (code) => {
            if (code === 0) {
              // Read the generated image and convert to base64
              readFile(tempImagePath, (err, data) => {
                if (err) {
                  reject(err);
                } else {
                  const base64 = `data:image/jpeg;base64,${data.toString('base64')}`;
                  resolve(base64);
                }
              });
            } else {
              reject(new Error(`FFmpeg process exited with code ${code}. stderr: ${stderr}`));
            }
          });
          
          ffmpeg.on('error', reject);
        });
        
        console.log(`[THUMBNAIL] Successfully extracted frame from video ${taskId}`);
        return thumbnailBase64;
        
      } finally {
        // Clean up temp files
        try {
          unlinkSync(tempVideoPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        try {
          unlinkSync(tempImagePath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
    } catch (error) {
      console.error(`[THUMBNAIL] Error extracting frame from video ${taskId}:`, error);
      return null;
    }
  }

  /**
   * Generate a placeholder thumbnail using SVG data URL
   */
  private generatePlaceholderThumbnail(taskId: string): string {
    // Create a more compact SVG without indentation issues
    const svg = `<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="grad-${taskId.slice(-8)}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#3b82f6;stop-opacity:0.4" /><stop offset="50%" style="stop-color:#8b5cf6;stop-opacity:0.3" /><stop offset="100%" style="stop-color:#ec4899;stop-opacity:0.4" /></linearGradient></defs><rect width="100%" height="100%" fill="url(#grad-${taskId.slice(-8)})"/><rect width="100%" height="100%" fill="rgba(0,0,0,0.5)"/><circle cx="160" cy="90" r="25" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><polygon points="150,80 150,100 170,90" fill="rgba(255,255,255,0.9)"/><text x="160" y="130" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="Arial" font-size="10">${taskId.slice(-8)}</text></svg>`;
    
    // Convert SVG to data URL using URL encoding instead of base64
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return dataUrl;
  }
  
  /**
   * Process thumbnail generation for a video when it becomes ready
   */
  async processVideoThumbnail(taskId: string, videoUrl: string): Promise<void> {
    try {
      const thumbnail = await this.generateThumbnail(videoUrl, taskId);
      
      if (thumbnail) {
        // Update video with thumbnail URL
        await storage.updateVideoThumbnail(taskId, thumbnail);
        console.log(`[THUMBNAIL] Updated video ${taskId} with thumbnail: ${thumbnail}`);
      } else {
        console.log(`[THUMBNAIL] No thumbnail generated for ${taskId}, UI will use fallback`);
      }
    } catch (error) {
      console.error(`[THUMBNAIL] Error processing thumbnail for ${taskId}:`, error);
      // Don't throw - this should not break the main video flow
    }
  }
  
  /**
   * Backfill thumbnails for existing videos
   */
  async backfillThumbnails(): Promise<void> {
    try {
      console.log('[THUMBNAIL] Starting backfill for videos without thumbnails');
      
      const videosWithoutThumbnails = await storage.getVideosWithoutThumbnails();
      console.log(`[THUMBNAIL] Found ${videosWithoutThumbnails.length} videos without thumbnails`);
      
      for (const video of videosWithoutThumbnails) {
        if (video.providerVideoUrl) {
          console.log(`[THUMBNAIL] Processing backfill for video ${video.taskId}`);
          await this.processVideoThumbnail(video.taskId, video.providerVideoUrl);
          
          // Small delay to avoid overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log('[THUMBNAIL] Backfill completed');
    } catch (error) {
      console.error('[THUMBNAIL] Error during backfill:', error);
    }
  }
}

export const thumbnailService = new ThumbnailService();