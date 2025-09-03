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
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kie.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const jsonResponse = await response.json();
    
    // Validate the response structure
    if (!jsonResponse || typeof jsonResponse !== 'object') {
      throw new Error('Invalid JSON response from Kie.ai API');
    }
    
    return jsonResponse;
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
