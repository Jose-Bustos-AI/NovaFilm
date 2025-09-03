import OpenAI from "openai";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

// Get chat model from environment or default to gpt-4o-mini
function getChatModel(): string {
  return process.env.CHAT_MODEL || 'gpt-4o-mini';
}

export interface PromptRefinementResult {
  prompt: string;
  model: string;
  aspectRatio: string;
  seeds?: number;
  enableFallback: boolean;
}

export interface ChatResponse {
  status?: string;
  final_prompt_en?: string;
  prompt_en?: string;
  aspect_ratio?: string;
  duration_seconds?: number;
  notes?: string;
  message?: string;
  needs_clarification?: boolean;
  choices?: string[];
}

// Export getChatModel for use in routes
export { getChatModel };

export async function refinePrompt(userInput: string): Promise<PromptRefinementResult> {
  try {
    // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are an AI video prompt expert. Take the user's idea (in any language) and refine it into an optimized English prompt for Kie.ai's Veo3 Fast model.

STRICT RULES:
- Always translate and respond in English only
- Create cinematic, detailed video prompts
- Include camera movements, lighting, and visual details
- Keep prompts under 500 characters
- Use vivid, descriptive language
- RESPOND ONLY WITH JSON - NO OTHER TEXT

Required JSON format (nothing else):
{
  "prompt": "<refined English prompt>",
  "model": "veo3_fast",
  "aspectRatio": "9:16",
  "seeds": null,
  "enableFallback": false
}`
        },
        {
          role: "user",
          content: userInput,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content || "{}";
    
    // Try to parse JSON response
    let result;
    try {
      result = JSON.parse(content);
    } catch (parseError) {
      // Fallback: try to extract first JSON block
      const jsonMatch = content.match(/\{[^}]*\}/);
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error("Failed to parse OpenAI response as JSON");
        }
      } else {
        throw new Error("No valid JSON found in OpenAI response");
      }
    }
    
    return {
      prompt: result.prompt || userInput,
      model: "veo3_fast",
      aspectRatio: result.aspectRatio || "9:16",
      seeds: result.seeds || null,
      enableFallback: false,
    };
  } catch (error) {
    console.error("OpenAI API error:", error);
    // Fallback to user input if OpenAI fails
    return {
      prompt: userInput,
      model: "veo3_fast",
      aspectRatio: "9:16",
      enableFallback: false,
    };
  }
}

// State management for conversation slots
interface ConversationSlots {
  tema?: string;
  momento?: string; // día, atardecer, noche
  clima?: string; // soleado, nublado, lluvia, tormenta
  vehiculo?: string;
  gente?: string; // sí, no
  tono?: string; // cinemático, emocionante, documental
}

// In-memory conversation state (in production, use Redis or session storage)
const conversationStates = new Map<string, ConversationSlots>();

// Helper function to extract information from free text
function extractSlotInfo(text: string): Partial<ConversationSlots> {
  const slots: Partial<ConversationSlots> = {};
  const lowerText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  // Momento del día
  if (lowerText.includes('noche') || lowerText.includes('nocturno') || lowerText.includes('night')) {
    slots.momento = 'noche';
  } else if (lowerText.includes('atardecer') || lowerText.includes('sunset') || lowerText.includes('dusk')) {
    slots.momento = 'atardecer';
  } else if (lowerText.includes('dia') || lowerText.includes('day') || lowerText.includes('manana') || lowerText.includes('morning')) {
    slots.momento = 'día';
  }
  
  // Clima
  if (lowerText.includes('tormenta') || lowerText.includes('storm')) {
    slots.clima = 'tormenta';
  } else if (lowerText.includes('lluvia') || lowerText.includes('llueve') || lowerText.includes('lloviendo') || lowerText.includes('rain')) {
    slots.clima = 'lluvia';
  } else if (lowerText.includes('nublado') || lowerText.includes('cloudy') || lowerText.includes('clouds')) {
    slots.clima = 'nublado';
  } else if (lowerText.includes('sol') || lowerText.includes('sunny') || lowerText.includes('clear')) {
    slots.clima = 'soleado';
  }
  
  // Vehículo
  if (lowerText.includes('moto') || lowerText.includes('motorcycle') || lowerText.includes('bike')) {
    slots.vehiculo = 'moto';
  } else if (lowerText.includes('coche') || lowerText.includes('car') || lowerText.includes('auto')) {
    slots.vehiculo = 'coche';
  }
  
  // Gente
  if (lowerText.includes('sola') || lowerText.includes('solo') || lowerText.includes('alone')) {
    slots.gente = 'no';
  } else if (lowerText.includes('gente') || lowerText.includes('people') || lowerText.includes('publico')) {
    slots.gente = 'sí';
  }
  
  return slots;
}

// Helper function to generate clarifying questions with choices
function generateClarifyingQuestion(missingSlots: string[]): { question: string; choices: string[] } {
  const questionsAndChoices: Record<string, { question: string; choices: string[] }> = {
    momento: {
      question: "¿Prefieres que sea de día, al atardecer o de noche?",
      choices: ["Día", "Atardecer", "Noche"]
    },
    clima: {
      question: "¿Cómo debe ser el clima?",
      choices: ["Soleado", "Nublado", "Lluvia", "Tormenta"]
    },
    vehiculo: {
      question: "¿Qué tipo de vehículo?",
      choices: ["Moto", "Coche", "Ninguno"]
    },
    gente: {
      question: "¿Debe aparecer gente en el video?",
      choices: ["Sí, con gente", "No, solo/a"]
    },
    tono: {
      question: "¿Qué estilo prefieres?",
      choices: ["Cinemático", "Emocionante", "Documental"]
    }
  };
  
  const slot = missingSlots[0];
  return questionsAndChoices[slot] || {
    question: "¿Podrías ser más específico?",
    choices: []
  };
}

export async function generateChatResponse(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Promise<string | ChatResponse> {
  try {
    const model = getChatModel();
    
    // Get user ID for conversation state (use a simple hash of conversation for demo)
    const conversationId = messages.slice(-3).map(m => m.content).join('').slice(0, 20);
    let slots = conversationStates.get(conversationId) || {};
    
    // Extract info from latest user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (lastUserMessage) {
      const extractedInfo = extractSlotInfo(lastUserMessage.content);
      slots = { ...slots, ...extractedInfo };
      conversationStates.set(conversationId, slots);
      
      console.log(`[CHAT] Conversation ${conversationId}: extracted info:`, extractedInfo);
      console.log(`[CHAT] Current slots:`, slots);
    }
    
    // Check if we have enough information to generate final prompt
    const requiredSlots: (keyof ConversationSlots)[] = ['momento', 'clima'];
    const missingSlots = requiredSlots.filter(slot => !slots[slot]);
    
    if (missingSlots.length > 0) {
      // Ask clarifying question with choices
      const { question, choices } = generateClarifyingQuestion(missingSlots);
      console.log(`[CHAT] Missing slots: ${missingSlots.join(', ')}, asking: ${question}`);
      
      if (choices.length > 0) {
        return {
          message: question,
          needs_clarification: true,
          choices: choices
        } as ChatResponse;
      } else {
        return question;
      }
    }
    
    // We have enough info - generate final prompt
    const tema = slots.tema || lastUserMessage?.content || "video scene";
    const finalPromptEn = `A cinematic ${slots.momento === 'noche' ? 'night' : slots.momento === 'atardecer' ? 'sunset' : 'day'} scene with ${slots.clima === 'tormenta' ? 'stormy weather and heavy rain' : slots.clima === 'lluvia' ? 'rain' : slots.clima === 'nublado' ? 'cloudy skies' : 'clear sunny weather'}. ${tema}. Professional cinematography with dynamic camera movements, vivid details, and atmospheric lighting. 8 seconds duration, 9:16 aspect ratio.`;
    
    // Clear conversation state after generating final prompt
    conversationStates.delete(conversationId);
    
    console.log(`[CHAT] Final prompt generated:`, finalPromptEn);
    
    return {
      prompt_en: finalPromptEn,
      aspect_ratio: "9:16",
      duration_seconds: 8
    } as ChatResponse;
    
  } catch (error) {
    console.error("[CHAT] Error:", error);
    
    // Graceful fallback - never show "Error en la respuesta"
    const fallbackMessages = [
      "No me quedó claro, ¿puedes decirlo en una frase más corta?",
      "¿Podrías darme más detalles sobre la escena que quieres crear?",
      "Cuéntame qué tipo de video tienes en mente."
    ];
    
    const randomFallback = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
    console.log(`[CHAT] Using fallback message: ${randomFallback}`);
    
    return randomFallback;
  }
}
