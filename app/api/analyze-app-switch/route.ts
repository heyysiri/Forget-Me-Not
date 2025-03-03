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
  const activityLog = activities
    .map((a) => {
      const time = new Date(a.content.timestamp).toLocaleTimeString();
      return `- Time: ${time} | App: ${a.content.appName || 'Unknown'} | Window: ${a.content.windowName || 'N/A'} | Text: ${a.content.text?.substring(0, 50) || 'N/A'}`;
    })
    .join('\n');
    console.log(activityLog);

  return `# Smart Reminder Analysis

## Activity Log
${activityLog}

## Analysis Task
Please analyze the user's app usage patterns to identify potential reminders they might need. 
Focus on the following patterns:

1. Brief app interactions (less than 10 seconds in an app) that might indicate unfinished tasks
2. Quick switches between apps that suggest the user might have been interrupted
3. Opening apps that are typically used for specific tasks (banking, calendar, email, etc.) but only briefly

## Response Format
Provide your analysis in the following format:

1. **Reminder Suggestions**: For each potential reminder, include:
   - Title: A short title for the notification
   - Description: A brief, helpful message asking if they need to return to a task
   - App Name: The relevant app name
   - Should Remind: true/false (whether this is important enough to show a notification)

Focus on being helpful and non-intrusive. Only suggest reminders for truly incomplete tasks or brief interactions that suggest the user might need to revisit something later.`;
}

// Extract suggestions from AI response
function extractSuggestions(analysis: string): Array<{
  title: string;
  description: string;
  appName?: string;
  shouldRemind: boolean;
}> {
  const suggestions = [];
  
  // Try to find reminder suggestions in the AI response
  const reminderSectionRegex = /reminder suggestions:?[\s\S]*?(?=general insights:|$)/i;
  const reminderSection = reminderSectionRegex.exec(analysis)?.[0] || "";
  
  // If we found a reminder section, extract each reminder
  if (reminderSection) {
    // Look for patterns like "Title: Something" or similar
    const titleRegex = /title:?\s*([^\n]+)/gi;
    let match;
    
    while ((match = titleRegex.exec(reminderSection)) !== null) {
      // Get the title
      const title = match[1].trim();
      
      // Try to find a description and app name near this title
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(reminderSection.length, match.index + 300);
      const context = reminderSection.substring(contextStart, contextEnd);
      
      const descMatch = /description:?\s*([^\n]+)/i.exec(context);
      const appNameMatch = /app name:?\s*([^\n]+)/i.exec(context);
      const shouldRemindMatch = /should remind:?\s*(true|false)/i.exec(context);
      
      if (descMatch) {
        suggestions.push({
          title: title,
          description: descMatch[1].trim(),
          appName: appNameMatch ? appNameMatch[1].trim() : undefined,
          shouldRemind: shouldRemindMatch ? shouldRemindMatch[1].toLowerCase() === 'true' : true
        });
      }
    }
  }
  
  return suggestions;
}