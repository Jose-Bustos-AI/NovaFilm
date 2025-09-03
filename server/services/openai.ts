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
  aspect_ratio?: string;
  notes?: string;
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

export async function generateChatResponse(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Promise<string | ChatResponse> {
  try {
    const model = getChatModel();
    
    // Build request parameters based on model capabilities
    const requestParams: any = {
      model: model,
      messages: [
        {
          role: "system",
          content: `Eres un asistente de prompt-engineering. Responde SIEMPRE en el idioma del usuario (detecta automáticamente).
Flujo:
1) Si aún NO tienes toda la info, haz 3–4 preguntas CORTAS y concretas para refinar la idea de un video (tema, estilo, lugar, tono, presencia de gente, duración, relación de aspecto). Una pregunta por turno; respuestas rápidas.
2) Cuando tengas suficiente contexto, responde SOLO un JSON con esta forma:
   {
     "status": "ready",
     "final_prompt_en": "<prompt en INGLÉS optimizado para Kie Veo3 Fast>",
     "aspect_ratio": "9:16",
     "notes": "<breves notas opcionales>"
   }
3) No incluyas nada más fuera del JSON final.
Reglas:
- Sé breve y directo en las preguntas.
- Si el usuario habla en español, haz las preguntas en español; si habla en otro idioma, adáptate.
- El JSON final SIEMPRE con \`final_prompt_en\` en INGLÉS.`
        },
        ...messages
      ]
    };
    
    // Add max_completion_tokens only for models that support it
    if (model.includes('gpt-4') || model.includes('gpt-3.5')) {
      requestParams.max_completion_tokens = 500;
    }

    const response = await openai.chat.completions.create(requestParams);
    const content = response.choices[0].message.content || "";

    // Try to parse as JSON first
    try {
      const jsonMatch = content.match(/\{[^{}]*"status"[^{}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.status === "ready" && parsed.final_prompt_en) {
          return parsed as ChatResponse;
        }
      }
    } catch (parseError) {
      // Not JSON, continue as normal text
    }

    return content || "Lo siento, no pude generar una respuesta. Inténtalo de nuevo.";
  } catch (error) {
    console.error("OpenAI chat error:", error);
    
    // Handle unsupported parameter errors
    if ((error as any)?.code === 'unsupported_parameter') {
      console.log("Retrying without optional parameters...");
      try {
        const model = getChatModel();
        const basicResponse = await openai.chat.completions.create({
          model: model,
          messages: [
            {
              role: "system",
              content: `Eres un asistente de prompt-engineering. Responde SIEMPRE en el idioma del usuario (detecta automáticamente).
Flujo:
1) Si aún NO tienes toda la info, haz 3–4 preguntas CORTAS y concretas para refinar la idea de un video (tema, estilo, lugar, tono, presencia de gente, duración, relación de aspecto). Una pregunta por turno; respuestas rápidas.
2) Cuando tengas suficiente contexto, responde SOLO un JSON con esta forma:
   {
     "status": "ready",
     "final_prompt_en": "<prompt en INGLÉS optimizado para Kie Veo3 Fast>",
     "aspect_ratio": "9:16",
     "notes": "<breves notas opcionales>"
   }
3) No incluyas nada más fuera del JSON final.
Reglas:
- Sé breve y directo en las preguntas.
- Si el usuario habla en español, haz las preguntas en español; si habla en otro idioma, adáptate.
- El JSON final SIEMPRE con \`final_prompt_en\` en INGLÉS.`
            },
            ...messages
          ]
        });
        return basicResponse.choices[0].message.content || "Lo siento, no pude generar una respuesta. Inténtalo de nuevo.";
      } catch (retryError) {
        console.error("Retry also failed:", retryError);
      }
    }
    
    return "Estoy teniendo problemas temporales con el servicio de chat. Intenta de nuevo en unos segundos.";
  }
}
