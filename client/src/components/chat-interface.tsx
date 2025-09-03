import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useAuth } from "@/hooks/useAuth";
import { AuthModal } from "@/components/auth-modal";

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type ChatMode = 'idle' | 'refining' | 'ready';

interface RefinedPrompt {
  prompt: string;
  model: string;
  aspectRatio: string;
  seeds?: number;
  enableFallback: boolean;
}

export default function ChatInterface() {
  const { user } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "¡Hola! Soy tu asistente de videos con IA. ¿Qué tipo de video te gustaría crear hoy?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('idle');
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [refinementTimeout, setRefinementTimeout] = useState<NodeJS.Timeout | null>(null);
  const [quickChoices, setQuickChoices] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Database health check
  const { data: dbHealth } = useQuery({
    queryKey: ["/api/health/db"],
    refetchInterval: 60000,
  });

  // Function to parse JSON from assistant response
  const parseAssistantResponse = (data: any): { message: string; finalPrompt?: string; choices?: string[] } => {
    // Check if backend returned a JSON response object
    if (data.isJsonResponse && typeof data.response === 'object') {
      const jsonData = data.response;
      if ((jsonData.status === 'ready' && jsonData.final_prompt_en) || jsonData.prompt_en) {
        return {
          message: "Perfecto, ya tengo todo. Estoy preparando tu vídeo. Dame unos minutillos 🚀.",
          finalPrompt: jsonData.final_prompt_en || jsonData.prompt_en
        };
      }
      
      // Check for clarification request with choices
      if (jsonData.needs_clarification && jsonData.choices) {
        return {
          message: jsonData.message || "Selecciona una opción:",
          choices: jsonData.choices
        };
      }
    }
    
    // Fallback: try to parse from string response (legacy support)
    if (typeof data.response === 'string') {
      const jsonMatch = data.response.match(/\{[^}]*"(final_prompt_en|prompt_en)"[^}]*\}/);
      if (jsonMatch) {
        try {
          const jsonData = JSON.parse(jsonMatch[0]);
          if (jsonData.final_prompt_en || jsonData.prompt_en) {
            const messageWithoutJson = data.response.replace(jsonMatch[0], '').trim();
            return {
              message: messageWithoutJson || "Perfecto, ya tengo todo. Estoy preparando tu vídeo. Dame unos minutillos 🚀.",
              finalPrompt: jsonData.final_prompt_en || jsonData.prompt_en
            };
          }
        } catch (e) {
          console.log('Failed to parse JSON from response:', e);
        }
      }
      return { message: data.response };
    }
    
    // Never show generic errors - provide helpful fallback
    const fallbackMessages = [
      "¿Podrías decírmelo de otra manera?",
      "Cuéntame más detalles sobre tu idea.",
      "No me quedó claro, ¿puedes ser más específico?"
    ];
    
    const fallback = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
    console.log('Using frontend fallback message:', fallback);
    
    return { message: typeof data.response === 'string' ? data.response : fallback };
  };

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest('POST', '/api/chat', { 
        message,
        conversationHistory: conversationHistory 
      });
      return await response.json();
    },
    onSuccess: (data) => {
      const parsed = parseAssistantResponse(data);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: parsed.message,
        timestamp: new Date()
      }]);
      
      // Update conversation history
      setConversationHistory(prev => [
        ...prev,
        { role: 'assistant', content: parsed.message }
      ]);
      
      // Set quick choices if provided
      if (parsed.choices) {
        setQuickChoices(parsed.choices);
      } else {
        setQuickChoices([]);
      }
      
      // If we found a final prompt, trigger generation
      if (parsed.finalPrompt) {
        setChatMode('ready');
        // Clear timeout if it exists
        if (refinementTimeout) {
          clearTimeout(refinementTimeout);
          setRefinementTimeout(null);
        }
        
        // Auto-generate with the final prompt
        if (dbHealth && (dbHealth as any).ok) {
          generateMutation.mutate({
            prompt: parsed.finalPrompt,
            model: "veo3_fast",
            aspectRatio: "9:16",
            enableFallback: false
          });
        }
      }
      
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
        title: "Problema de conexión",
        description: "No pude enviar el mensaje. Inténtalo de nuevo por favor.",
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
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error en generación');
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Generación de Video Iniciada",
        description: "Tu video se está procesando. Suele tardar 2-5 minutos.",
      });
      
      // Refresh videos, jobs, and credits
      queryClient.invalidateQueries({ queryKey: ['/api/videos'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/account/me'] });
      
      // Add ETA message to chat
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `¡Perfecto! Ya está en marcha tu video. Suele tardar 2–5 minutos. Te aviso en cuanto esté listo y lo verás en tu galería automáticamente.`,
        timestamp: new Date()
      }]);
      
      // Reset chat mode
      setChatMode('idle');
      setConversationHistory([]);
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
      
      // Check if it's a credits error
      const errorMessage = error.message || "No se pudo iniciar la generación del video. Inténtalo de nuevo.";
      
      toast({
        title: errorMessage.includes('créditos') ? "Sin Créditos" : "Error en Generación",
        description: errorMessage,
        variant: "destructive",
      });
      
      // If it's a credits error, add helpful message to chat
      if (errorMessage.includes('créditos')) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `¡Oh no! Se te han acabado los créditos. Ve a "Mi Cuenta" para añadir más créditos y seguir creando videos increíbles.`,
          timestamp: new Date()
        }]);
      }
      
      // Reset chat mode on error
      setChatMode('idle');
      setConversationHistory([]);
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
      
      // Check database health before auto-generating
      if (dbHealth && (dbHealth as any).ok) {
        generateMutation.mutate(refinedPrompt);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠️ Cannot generate video: Database not configured. Please contact administrator to set up DATABASE_URL.',
          timestamp: new Date()
        }]);
      }
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

  // Set up refinement timeout
  useEffect(() => {
    if (chatMode === 'refining' && !refinementTimeout) {
      const timeout = setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "¿Seguimos? Puedo generar el video con lo que tengo hasta ahora.",
          timestamp: new Date()
        }]);
        setRefinementTimeout(null);
      }, 90000); // 90 seconds
      setRefinementTimeout(timeout);
    }
    
    return () => {
      if (refinementTimeout) {
        clearTimeout(refinementTimeout);
      }
    };
  }, [chatMode, refinementTimeout]);

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;

    // Check if user is authenticated
    if (!user) {
      setShowAuthModal(true);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Para generar videos necesitas iniciar sesión. ¡Te espero del otro lado! 🚀",
        timestamp: new Date()
      }]);
      return;
    }

    const userMessage = input.trim();
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);
    
    // Update conversation history
    setConversationHistory(prev => [
      ...prev,
      { role: 'user', content: userMessage }
    ]);
    
    setInput("");
    setQuickChoices([]); // Clear choices when user sends a message
    setIsTyping(true);

    // Clear any existing refinement timeout
    if (refinementTimeout) {
      clearTimeout(refinementTimeout);
      setRefinementTimeout(null);
    }

    // Set mode to refining on first user message (if not already refining)
    if (chatMode === 'idle') {
      setChatMode('refining');
    }

    // Always use the chat mutation for the conversational flow
    chatMutation.mutate(userMessage);
  };

  const handleQuickChoice = (choice: string) => {
    setInput(choice);
    // Auto-send the choice
    setTimeout(() => {
      const userMessage = choice;
      setMessages(prev => [...prev, {
        role: 'user',
        content: userMessage,
        timestamp: new Date()
      }]);
      
      // Update conversation history
      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: userMessage }
      ]);
      
      setInput("");
      setQuickChoices([]); // Clear choices
      setIsTyping(true);

      if (chatMode === 'idle') {
        setChatMode('refining');
      }

      chatMutation.mutate(userMessage);
    }, 100);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isLoading = chatMutation.isPending || refineMutation.isPending || generateMutation.isPending;

  return (
    <Card className="h-[420px] flex flex-col">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2-2V7a2 2 0 012-2h2a2 2 0 002 2v2a2 2 0 002 2h2a2 2 0 012-2V7a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 00-2 2h-2a2 2 0 00-2 2v6a2 2 0 01-2 2H9z" />
          </svg>
          AI Video Assistant
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Describe tu idea y te ayudo a crear el video perfecto
        </p>
      </CardHeader>
      
      <CardContent className="flex flex-col flex-1 p-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[280px]">
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
                className={`max-w-prose rounded-lg p-3 whitespace-pre-wrap break-words ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <p className="text-sm leading-relaxed">{message.content}</p>
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
              <div className="bg-muted rounded-lg p-3 max-w-prose">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Quick choices */}
        {quickChoices.length > 0 && (
          <div className="border-t border-border p-4 pb-2">
            <div className="flex flex-wrap gap-2">
              {quickChoices.map((choice, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickChoice(choice)}
                  className="px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-sm border border-primary/20 transition-colors"
                  data-testid={`chip-choice-${index}`}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {/* Input */}
        <div className={`border-t border-border p-4 ${quickChoices.length > 0 ? 'pt-2' : ''}`}>
          <div className="flex gap-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Cuéntame tu idea para el video..."
              className="flex-1"
              disabled={isLoading}
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || !input.trim() || !dbHealth || !(dbHealth as any)?.ok}
              data-testid="button-send-message"
              title={!dbHealth || !(dbHealth as any)?.ok ? "Database not configured" : "Send message"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </Button>
          </div>
        </div>
      </CardContent>
      
      <AuthModal 
        open={showAuthModal} 
        onOpenChange={setShowAuthModal}
        onAuthSuccess={() => {
          // Refresh user data after successful auth
          queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
          queryClient.invalidateQueries({ queryKey: ['/api/account/me'] });
        }}
      />
    </Card>
  );
}
