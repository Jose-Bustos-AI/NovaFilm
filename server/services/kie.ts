interface KieVideoGenerationRequest {
  prompt: string;
  model: string;
  aspectRatio: string;
  callBackUrl: string;
  seeds?: number;
  enableFallback?: boolean;
}

interface KieVideoGenerationResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    runId?: string;
  };
}

interface KieCallbackData {
  code: number;
  msg: string;
  data: {
    taskId: string;
    info: {
      resultUrls: string[];
      resolution: string;
    };
    fallbackFlag: boolean;
  };
}

export class KieAiService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.KIE_API_BASE || "https://api.kie.ai/api/v1";
    this.apiKey = process.env.KIE_API_KEY || process.env.KIE_API_KEY_ENV_VAR || "default_key";
  }

  async generateVideo(request: KieVideoGenerationRequest): Promise<KieVideoGenerationResponse> {
    const url = `${this.baseUrl}/veo/generate`;
    
    // Debug logging (without exposing full prompt)
    console.log(`[KIE-DEBUG] Endpoint: ${url}, Model: ${request.model}, AspectRatio: ${request.aspectRatio}, PromptLength: ${request.prompt.length}`);
    console.log(`[KIE-DEBUG] CallBackUrl: ${request.callBackUrl}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
    });

    // Log raw response status and body (truncated)
    const responseText = await response.text();
    const truncatedBody = responseText.length > 3000 ? responseText.substring(0, 3000) + '...[truncated]' : responseText;
    console.log(`[KIE-RAW-RESPONSE] Status: ${response.status}, Body: ${truncatedBody}`);

    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(`Kie.ai API returned invalid JSON: ${response.status} ${response.statusText} - ${truncatedBody}`);
    }

    // Tolerant taskId parsing - check multiple possible fields
    const extractTaskId = (body: any): string | null => {
      const data = body?.data ?? body;
      return data?.taskId || data?.task_id || data?.id || body?.taskId || body?.task_id || body?.id || null;
    };

    const taskId = extractTaskId(jsonResponse);

    // Handle non-200 status or missing taskId
    if (response.status !== 200 || !taskId || !jsonResponse?.data) {
      const errorMsg = jsonResponse?.msg || jsonResponse?.message || response.statusText || 'Invalid response';
      throw new Error(`HTTP ${response.status} - ${errorMsg}`);
    }
    
    // Return standardized response
    return {
      code: jsonResponse.code || 200,
      msg: jsonResponse.msg || 'Success',
      data: {
        taskId: taskId,
        runId: jsonResponse.data?.runId || jsonResponse.data?.run_id || undefined
      }
    };
  }

  async getRecordInfo(taskId: string): Promise<any> {
    const url = `${this.baseUrl}/veo/record-info?taskId=${taskId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Kie.ai record info error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  parseCallback(callbackData: any): KieCallbackData {
    return {
      code: callbackData.code,
      msg: callbackData.msg,
      data: {
        taskId: callbackData.data.taskId,
        info: {
          resultUrls: callbackData.data.info.resultUrls || [],
          resolution: callbackData.data.info.resolution || "1080p",
        },
        fallbackFlag: callbackData.data.fallbackFlag || false,
      },
    };
  }
}

export const kieService = new KieAiService();
