import OpenAI from "openai";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

export interface PromptRefinementResult {
  prompt: string;
  model: string;
  aspectRatio: string;
  seeds?: number;
  enableFallback: boolean;
}

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

export async function generateChatResponse(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Promise<string> {
  try {
    // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are a helpful AI video generation assistant. Help users refine their video ideas and create better prompts for AI video generation. Be concise but creative."
        },
        ...messages
      ],
      max_tokens: 500,
    });

    return response.choices[0].message.content || "I apologize, but I couldn't generate a response. Please try again.";
  } catch (error) {
    console.error("OpenAI chat error:", error);
    return "I'm having trouble connecting to the AI service right now. Please try again in a moment.";
  }
}
