import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface RefinedPrompt {
  prompt: string;
  model: string;
  aspectRatio: string;
  seeds?: number;
  enableFallback: boolean;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm here to help you create amazing videos. What kind of video would you like to generate today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest('POST', '/api/chat', { message });
      return await response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        timestamp: new Date()
      }]);
      setIsTyping(false);
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
      setIsTyping(false);
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (refinedPrompt: RefinedPrompt) => {
      const response = await apiRequest('POST', '/api/create-job', {
        prompt: refinedPrompt.prompt,
        aspectRatio: refinedPrompt.aspectRatio,
        seeds: refinedPrompt.seeds,
      });
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Video Generation Started",
        description: "Your video is being processed. This may take a few minutes.",
      });
      
      // Refresh videos and jobs
      queryClient.invalidateQueries({ queryKey: ['/api/videos'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      
      // Add success message to chat
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Great! I've started generating your video. Task ID: ${data.taskId}. You can track the progress in the Active Jobs panel.`,
        timestamp: new Date()
      }]);
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      
      toast({
        title: "Generation Failed",
        description: "Failed to start video generation. Please try again.",
        variant: "destructive",
      });
    },
  });

  const refineMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const response = await apiRequest('POST', '/api/refine-prompt', { prompt });
      return await response.json();
    },
    onSuccess: (refinedPrompt: RefinedPrompt) => {
      const message = `I'll create an optimized prompt for you:\n\n**Refined Prompt:** "${refinedPrompt.prompt}"\n\n**Settings:** ${refinedPrompt.aspectRatio} aspect ratio, ${refinedPrompt.model} model`;
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: message,
        timestamp: new Date()
      }]);
      
      // Auto-generate the video
      generateMutation.mutate(refinedPrompt);
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      
      toast({
        title: "Error",
        description: "Failed to refine prompt. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);
    
    setInput("");
    setIsTyping(true);

    // Check if message seems like a video generation request
    const isVideoRequest = userMessage.toLowerCase().includes('create') || 
                          userMessage.toLowerCase().includes('generate') || 
                          userMessage.toLowerCase().includes('make') ||
                          userMessage.length > 20; // Assume longer messages are descriptions

    if (isVideoRequest) {
      refineMutation.mutate(userMessage);
    } else {
      chatMutation.mutate(userMessage);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isLoading = chatMutation.isPending || refineMutation.isPending || generateMutation.isPending;

  return (
    <Card className="h-[500px] flex flex-col">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2-2V7a2 2 0 012-2h2a2 2 0 002 2v2a2 2 0 002 2h2a2 2 0 012-2V7a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 00-2 2h-2a2 2 0 00-2 2v6a2 2 0 01-2 2H9z" />
          </svg>
          AI Video Assistant
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Describe your video idea and I'll help you create the perfect prompt
        </p>
      </CardHeader>
      
      <CardContent className="flex flex-col flex-1 p-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2-2V7a2 2 0 012-2h2a2 2 0 002 2v2a2 2 0 002 2h2a2 2 0 012-2V7a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 00-2 2h-2a2 2 0 00-2 2v6a2 2 0 01-2 2H9z" />
                  </svg>
                </div>
              )}
              
              <div
                className={`max-w-xs rounded-lg p-3 whitespace-pre-wrap ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <p className="text-sm">{message.content}</p>
              </div>
              
              {message.role === 'user' && (
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium">You</span>
                </div>
              )}
            </div>
          ))}
          
          {(isTyping || isLoading) && (
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2-2V7a2 2 0 012-2h2a2 2 0 002 2v2a2 2 0 002 2h2a2 2 0 012-2V7a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 00-2 2h-2a2 2 0 00-2 2v6a2 2 0 01-2 2H9z" />
                </svg>
              </div>
              <div className="bg-muted rounded-lg p-3 max-w-xs">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Input */}
        <div className="border-t border-border p-4">
          <div className="flex gap-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Describe your video idea..."
              className="flex-1"
              disabled={isLoading}
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              data-testid="button-send-message"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
