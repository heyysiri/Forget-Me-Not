import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { ollama } from 'ollama-ai-provider';
import { pipe } from '@screenpipe/js';
import { ReminderSuggestion, AnalysisResponse } from '../../../types/responses';

interface Activity {
  content: {
    appName?: string;
    windowName?: string;
    timestamp: string;
    text?: string;
  };
}

// 🛠 Extract structured reminders from AI response text
function extractSuggestionsFromText(text: string): AnalysisResponse {
  try {
    const suggestions: ReminderSuggestion[] = [];
    const insights: string[] = [];
    
    // Extract Reminder Suggestions
    const reminderSection = text.match(/### Reminder Suggestions([\s\S]*?)(?=###|$)/)?.[1] || '';
    const suggestionBlocks = reminderSection.split(/\d+\.\s+\*\*/);
    
    for (const block of suggestionBlocks) {
      if (!block.trim()) continue;
      
      const titleMatch = block.match(/Title:\s*(.*)/);
      const descMatch = block.match(/Description:\s*(.*)/);
      const appMatch = block.match(/App Name:\s*(.*)/);
      const windowMatch = block.match(/Window Name:\s*(.*)/);
      const shouldRemindMatch = block.match(/Should Remind:\s*(true|false)/);
      
      if (titleMatch && descMatch && appMatch) {
        suggestions.push({
          title: titleMatch[1].trim(),
          description: descMatch[1].trim(),
          appName: appMatch[1].trim(),
          windowName: windowMatch ? windowMatch[1].trim() : undefined,
          shouldRemind: shouldRemindMatch ? shouldRemindMatch[1].toLowerCase() === 'true' : true
        });
      }
    }
    
    // Extract General Insights
    const insightsSection = text.match(/### General Insights([\s\S]*?)(?=###|$)/)?.[1] || '';
    const insightLines = insightsSection.split(/\d+\.\s+\*\*/);
    
    for (const line of insightLines) {
      const trimmed = line.trim();
      if (trimmed) {
        insights.push(trimmed);
      }
    }
    
    return {
      reminderSuggestions: suggestions,
      generalInsights: insights
    };
  } catch (error) {
    console.error('Failed to parse response:', error);
    return {
      reminderSuggestions: [],
      generalInsights: []
    };
  }
}

// 🛠 Handle AI-based reminder analysis
// Create a dedicated function for prompt creation
// Update the createAIPrompt function to limit data size

function createAIPrompt(activities: Activity[], logs: any[] = []): string {
  // Limit to maximum 20 most recent activities to prevent payload size issues
  const limitedActivities = activities.slice(-20);
  
  // Format activity log for the prompt - limit text content length
  const activityLog = limitedActivities.map((a) => ({
    timestamp: new Date(a.content.timestamp).toLocaleTimeString(),
    appName: a.content.appName || 'Unknown',
    windowName: a.content.windowName || 'N/A',
    text: a.content.text?.substring(0, 30) || 'N/A'
  }));

  return `Analyze these user activities and provide reminder suggestions in this exact format:

### Reminder Suggestions

For each suggestion:
1. **Title**: [brief title]
   * Description: [detailed description]
   * App Name: [app name]
   * Window Name: [window name if relevant]
   * Should Remind: [true/false]

### General Insights

1. **[First Insight]**
2. **[Second Insight]**
3. **[Third Insight]**

Please ensure each reminder includes all fields and follows the exact format above.`;
}

// Now update the POST handler to use this function
// Update the POST handler to handle payloads more efficiently

export async function POST(request: Request) {
  try {
    // Get settings from Screenpipe directly in the API
    const settings = await pipe.settings.getAll();
    
    // Parse request body
    const body = await request.json();
    const { activities, prompt: customPrompt } = body;
    
    if (!Array.isArray(activities)) {
      return NextResponse.json(
        { error: "Missing required activities array" },
        { status: 400 }
      );
    }
    
    // Log what we received
    console.log(`API: Analyzing ${activities.length} activities`);
    
    // Limit number of activities to prevent payload too large errors
    const limitedActivities = activities.length > 20 ? activities.slice(-20) : activities;
    console.log(`API: Limited to ${limitedActivities.length} most recent activities`);
    
    // Use custom prompt if provided, otherwise create one
    const prompt = customPrompt || createAIPrompt(limitedActivities);
    
    // Estimate prompt size to warn about potential issues
    const promptSize = Buffer.byteLength(prompt, 'utf8') / 1024;
    console.log(`API: Prompt size is approximately ${promptSize.toFixed(2)}KB`);
    if (promptSize > 30) {
      console.warn(`API: Warning - prompt size is large (${promptSize.toFixed(2)}KB), may cause issues with some models`);
    }
    
    // Log request details
    console.log(`API: Using AI provider ${settings.aiProviderType}`);

    let modelResponse: string;
    let { aiProviderType, aiModel, aiUrl, openaiApiKey } = settings as {
      aiProviderType: 'ollama' | 'native-ollama' | 'openai',
      aiModel: string,
      aiUrl: string,
      openaiApiKey?: string
    };

    // Fix URL for native Ollama
    if (aiProviderType === 'native-ollama') {
      aiUrl = 'http://localhost:11434/api/generate';
    }

    // Ollama AI Processing
    if (aiProviderType === 'ollama' || aiProviderType === 'native-ollama') {
      console.log("API: Using Ollama for generation with model:", aiModel);
      try {
        const model = ollama(aiModel);
        const generateTextResult = await generateText({
          model,
          messages: [{ role: 'user', content: prompt }],
          maxRetries: 3,
        });

        console.log("API: Ollama response received successfully");
        modelResponse = generateTextResult.text || 'No response from model';
        console.log("API: Ollama response:", modelResponse);
      } catch (error) {
        console.error("API: Error using Ollama:", error);
        modelResponse = `Unable to generate AI analysis. Error with Ollama model ${aiModel}.`;
      }
    } 
    // OpenAI-Compatible API Processing
    else {
      console.log("API: Using OpenAI-compatible API");
      try {
        console.log(`API: OpenAI request sent to ${aiUrl} for model ${aiModel}`);
        
        const response = await fetch(aiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(openaiApiKey ? { 'Authorization': `Bearer ${openaiApiKey}` } : {}),
          },
          body: JSON.stringify({
            model: aiModel,
            messages: [{ role: 'user', content: prompt }],
            // Add these parameters to help with large requests
            max_tokens: 500,
            temperature: 0.7,
          }),
        });
        
        // Don't consume the response body here!
        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const jsonResponse = await response.json();
        modelResponse = jsonResponse.choices?.[0]?.message?.content || 'No response from model';
        console.log("API: OpenAI-compatible API response received successfully");
      } catch (error) {
        console.error("API: Error using OpenAI-compatible API:", error);
        modelResponse = `Unable to generate AI analysis. Error with OpenAI-compatible API using model ${aiModel}.`;
      }
    }

    // Extract structured suggestions from AI response
    const suggestions = extractSuggestionsFromText(modelResponse);

    return NextResponse.json({
      analysis: modelResponse,
      ...extractSuggestionsFromText(modelResponse),
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in reminder analysis:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
