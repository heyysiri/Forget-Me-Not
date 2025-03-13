import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { ollama } from 'ollama-ai-provider';

interface Activity {
  content: {
    timestamp: string;
    appName?: string;
    windowName?: string;
    text?: string;
  };
}

interface UserSettings {
  aiProviderType: string;
  aiModel: string;
  aiUrl: string;
  apiKey: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { activities, prompt, userSettings } = body;
    
    if (!activities || !Array.isArray(activities) || !userSettings) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }
    
    console.log('API: Analyzing reminders');
    console.log(`API: Using AI provider ${userSettings.aiProviderType} with model ${userSettings.aiModel}`);
    console.log(`API: Processing ${activities.length} activities`);
    
    let modelResponse: string = '';
    const aiPrompt = prompt || createDefaultPrompt(activities);
    
    // Handle different AI providers
    let { aiProviderType, aiModel, aiUrl, apiKey } = userSettings;
    
    // Fix URL for native-ollama
    if (aiProviderType === 'native-ollama') {
      aiUrl = 'http://localhost:11434/api/generate';
    }

    // Log settings (excluding API key)
    console.log('API: AI Provider:', aiProviderType);
    console.log('API: AI Model:', aiModel);
    console.log('API: AI URL:', aiUrl);

    // Use ollama provider
    if (aiProviderType === 'ollama' || aiProviderType === 'native-ollama') {
      console.log("API: Using Ollama for generation");
      const model = ollama(aiModel);
      
      const generateTextResult = await generateText({
        model,
        messages: [{ role: 'user', content: aiPrompt }],
        maxRetries: 3,
      });
      
      modelResponse = generateTextResult.text ?? 'No response from model';
    } else {
      // OpenAI or other API-based providers
      console.log(`API: Using ${aiProviderType} for generation`);
      
      const response = await fetch(aiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [{ role: 'user', content: aiPrompt }],
        }),
      });
      
      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }
      
      const jsonResponse = await response.json();
      modelResponse = jsonResponse.choices?.[0]?.message?.content ?? 'No response from model';
    }

    // Extract suggestions from the AI response
    const suggestions = extractSuggestions(modelResponse);
    
    return NextResponse.json({
      analysis: modelResponse,
      suggestions: suggestions,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Error in analyze-reminders API:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Create default prompt if none provided
function createDefaultPrompt(activities: Activity[]): string {
  const activityLog = activities.map((a) => ({
    timestamp: new Date(a.content.timestamp).toLocaleTimeString(),
    appName: a.content.appName || 'Unknown',
    windowName: a.content.windowName || 'N/A',
    text: a.content.text?.substring(0, 50) || 'N/A'
  }));

  return `Analyze these app switching patterns and generate suggestions. 
Response must be valid JSON matching this TypeScript interface:

interface Response {
  suggestions: Array<{
    title: string;
    description: string;
    appName: string;
    shouldRemind: boolean;
    switchPattern: {
      from: string;
      to: string;
      frequency: number;
    };
    confidence: number; // 0-1
  }>;
  patterns: {
    frequentSwitches: Array<string[]>;
    potentialInterruptions: string[];
  };
}

Activities:
${JSON.stringify(activityLog, null, 2)}

Rules:
1. Identify rapid app switches (<10s)
2. Look for context switches
3. Find interrupted workflows
4. Only include high-confidence suggestions

Respond ONLY with valid JSON.`;
}

// Extract suggestions from AI response
function extractSuggestions(analysis: string): Array<any> {
  try {
    // Try to find a JSON object in the response
    const jsonMatch = analysis.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
      return [];
    }
    
    return parsed.suggestions.map((suggestion: { title: any; description: any; appName: any; shouldRemind: any; confidence: any; switchPattern: any; }) => ({
      title: suggestion.title,
      description: suggestion.description,
      appName: suggestion.appName,
      shouldRemind: suggestion.shouldRemind,
      confidence: suggestion.confidence,
      switchPattern: suggestion.switchPattern
    }));
  } catch (error) {
    console.error('Failed to parse AI response as JSON:', error);
    return [];
  }
}