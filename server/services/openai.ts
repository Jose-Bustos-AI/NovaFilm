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


export async function generateChatResponse(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Promise<string | ChatResponse> {
  try {
    const model = getChatModel();
    
    // Build request parameters based on model capabilities
    const requestParams: any = {
      model: model,
      messages: [
        {
          role: "system",
          content: `Eres un asistente de prompt-engineering para un generador de videos IA (Kie Veo3 Fast).

REGLAS DE IDIOMA:
- Detecta el idioma del usuario y respóndele SIEMPRE en ese mismo idioma
- El prompt final para Kie.ai siempre va en inglés

OBJETIVO: 
Hacer máximo 3 rondas de 1-3 preguntas cortas y útiles, luego generar el video.

NUNCA preguntes por:
- Duración (siempre 8 segundos)
- Formato (siempre 9:16 móvil)

PREGUNTAS RELEVANTES (elige las que apliquen según el tema):
- "¿Es de día o de noche?"
- "¿Qué estilo visual buscas (realista, cinematográfico, vintage, animado)?"
- "¿Quieres gente alrededor o solo el sujeto principal?"
- "¿Algún detalle de ambiente? (lluvia, viento, charcos, hojas, neón, etc.)"
- "¿Algún tipo específico? (moto de cross, café racer; coche clásico, F1; etc.)"
- "¿Algún movimiento de cámara? (FPV, dolly-in, gimbal, dron, barrido)"
- "¿Algún color/atmósfera dominante? (golden hour, neón, bruma)"

CRITERIOS DE CIERRE (deja de preguntar y genera):
1. Se alcanzan 3 rondas de preguntas, O
2. El usuario dice palabras de cierre: "ya", "hazlo", "crea el video", "dale", "genera", "listo", "ok", "perfecto", "go ahead", "do it", "generate", "create it", O
3. El usuario responde con vaguedades: "da igual", "como quieras", "no sé" → usa defaults

DEFAULTS SI FALTA INFO:
- Hora: atardecer (golden hour)
- Estilo: cinematográfico realista
- Gente: solo sujeto principal + extras sutiles si encaja
- Clima: despejado (añadir lluvia/viento solo si lo pidió)
- Cámara: gimbal con algún momento FPV o dolly-in
- Color: contraste suave y viñeteado ligero

FORMATO DE SALIDA:
Cuando cumplas criterio de cierre, responde:
1. Mensaje de confirmación en el idioma del usuario: "Perfecto, ya tengo todo. Estoy preparando tu vídeo. Dame unos minutillos 🚀"
2. Luego SOLO este JSON:
{
  "prompt_en": "<prompt cinematográfico en inglés, 1-2 frases de escena + 1 frase de cámara + 1 frase de look&feel>",
  "aspect_ratio": "9:16", 
  "duration_seconds": 8
}`
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

    // Try to parse as JSON first - look for JSON anywhere in the response
    try {
      // Look for JSON pattern more broadly
      const jsonMatch = content.match(/\{[\s\S]*?"prompt_en"[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.prompt_en && parsed.aspect_ratio && parsed.duration_seconds) {
          return parsed as ChatResponse;
        }
      }
    } catch (parseError) {
      // If JSON parsing fails, try more aggressive extraction
      try {
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          const jsonStr = content.substring(jsonStart, jsonEnd + 1);
          const parsed = JSON.parse(jsonStr);
          if (parsed.prompt_en && parsed.aspect_ratio && parsed.duration_seconds) {
            return parsed as ChatResponse;
          }
        }
      } catch (secondParseError) {
        // Not JSON, continue as normal text
      }
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
              content: `Eres un asistente de prompt-engineering para un generador de videos IA (Kie Veo3 Fast).

REGLAS DE IDIOMA:
- Detecta el idioma del usuario y respóndele SIEMPRE en ese mismo idioma
- El prompt final para Kie.ai siempre va en inglés

OBJETIVO: 
Hacer máximo 3 rondas de 1-3 preguntas cortas y útiles, luego generar el video.

NUNCA preguntes por:
- Duración (siempre 8 segundos)
- Formato (siempre 9:16 móvil)

PREGUNTAS RELEVANTES (elige las que apliquen según el tema):
- "¿Es de día o de noche?"
- "¿Qué estilo visual buscas (realista, cinematográfico, vintage, animado)?"
- "¿Quieres gente alrededor o solo el sujeto principal?"
- "¿Algún detalle de ambiente? (lluvia, viento, charcos, hojas, neón, etc.)"
- "¿Algún tipo específico? (moto de cross, café racer; coche clásico, F1; etc.)"
- "¿Algún movimiento de cámara? (FPV, dolly-in, gimbal, dron, barrido)"
- "¿Algún color/atmósfera dominante? (golden hour, neón, bruma)"

CRITERIOS DE CIERRE (deja de preguntar y genera):
1. Se alcanzan 3 rondas de preguntas, O
2. El usuario dice palabras de cierre: "ya", "hazlo", "crea el video", "dale", "genera", "listo", "ok", "perfecto", "go ahead", "do it", "generate", "create it", O
3. El usuario responde con vaguedades: "da igual", "como quieras", "no sé" → usa defaults

DEFAULTS SI FALTA INFO:
- Hora: atardecer (golden hour)
- Estilo: cinematográfico realista
- Gente: solo sujeto principal + extras sutiles si encaja
- Clima: despejado (añadir lluvia/viento solo si lo pidió)
- Cámara: gimbal con algún momento FPV o dolly-in
- Color: contraste suave y viñeteado ligero

FORMATO DE SALIDA:
Cuando cumplas criterio de cierre, responde:
1. Mensaje de confirmación en el idioma del usuario: "Perfecto, ya tengo todo. Estoy preparando tu vídeo. Dame unos minutillos 🚀"
2. Luego SOLO este JSON:
{
  "prompt_en": "<prompt cinematográfico en inglés, 1-2 frases de escena + 1 frase de cámara + 1 frase de look&feel>",
  "aspect_ratio": "9:16", 
  "duration_seconds": 8
}`
            },
            ...messages
          ]
        });
        return basicResponse.choices[0].message.content || "Lo siento, no pude generar una respuesta. Inténtalo de nuevo.";
      } catch (retryError) {
        console.error("Retry also failed:", retryError);
      }
    }
    
    // Graceful fallback messages in Spanish
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
