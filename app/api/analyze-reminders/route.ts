import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { ollama } from 'ollama-ai-provider';
import { pipe } from '@screenpipe/js';

interface Activity {
  content: {
    appName?: string;
    windowName?: string;
    timestamp: string;
    text?: string;
  };
}

interface ReminderSuggestion {
  title: string;
  description: string;
  appName?: string;
  windowName?: string;
  shouldRemind: boolean;
}

// 🛠 Extract structured reminders from AI response text
function extractSuggestionsFromText(text: string): ReminderSuggestion[] {
  const suggestions: ReminderSuggestion[] = [];
  
  // Try to find reminder suggestions in a structured format
  const reminderSectionRegex = /reminder suggestions:?[\s\S]*?(?=general insights:|$)/i;
  const reminderSection = reminderSectionRegex.exec(text)?.[0] || "";
  
  if (reminderSection) {
    // Look for patterns like "App Name: Calendar" or similar
    const appNameRegex = /app name:?\s*([A-Za-z0-9\s]+)/gi;
    let appNameMatch;
    
    while ((appNameMatch = appNameRegex.exec(reminderSection)) !== null) {
      // Get the app name
      const appName = appNameMatch[1].trim();
      
      // Try to find a title and description near this app name
      const contextStart = Math.max(0, appNameMatch.index - 300); // Increased context size to find window name
      const contextEnd = Math.min(reminderSection.length, appNameMatch.index + 300);
      const context = reminderSection.substring(contextStart, contextEnd);
      
      const titleMatch = /title:?\s*([^\n]+)/i.exec(context);
      const descMatch = /description:?\s*([^\n]+)/i.exec(context);
      const windowNameMatch = /window name:?\s*([^\n]+)/i.exec(context);
      const shouldRemindMatch = /should remind:?\s*(true|false)/i.exec(context);
      
      if (titleMatch && descMatch) {
        suggestions.push({
          title: titleMatch[1].trim(),
          description: descMatch[1].trim(),
          appName,
          windowName: windowNameMatch ? windowNameMatch[1].trim() : undefined,
          shouldRemind: shouldRemindMatch ? shouldRemindMatch[1].toLowerCase() === 'true' : true
        });
      }
    }
  }
  
  // If no structured reminders were found, look for any mentions of brief app usage
  if (suggestions.length === 0) {
    const briefUsageRegex = /(briefly|quickly) (used|opened|checked|visited) ([A-Za-z0-9\s]+)(?:\s+(?:with|in|on)\s+(?:window|tab)?\s*['":]?\s*([^'".,\n]+))?/gi;
    let match;
    
    while ((match = briefUsageRegex.exec(text)) !== null) {
      const action = match[1];  // briefly/quickly
      const verb = match[2];    // used/opened/etc
      const appName = match[3]; // app name
      const windowName = match[4]; // window name if captured
      
      suggestions.push({
        title: `Quick ${appName} check detected`,
        description: windowName && windowName.trim() !== "" 
          ? `You ${action} ${verb} ${appName} with window "${windowName}". Need to return to it later?`
          : `You ${action} ${verb} ${appName}. Need to return to it later?`,
        appName,
        windowName: windowName && windowName.trim() !== "" ? windowName.trim() : undefined,
        shouldRemind: true
      });
    }
  }
  
  return suggestions;
}

// 🛠 Handle AI-based reminder analysis
// Create a dedicated function for prompt creation
// Update the createAIPrompt function to limit data size

function createAIPrompt(activities: Activity[], logs: any[] = []): string {
  // Limit to maximum 20 most recent activities to prevent payload size issues
  const limitedActivities = activities.slice(-20);
  
  // Format activity log for the prompt - limit text content length
  const activityLog = limitedActivities
    .map((a) => {
      const time = new Date(a.content.timestamp).toLocaleTimeString();
      const windowName = a.content.windowName || '';
      const appName = a.content.appName || 'Unknown';
      
      // Limit text length to 30 characters to reduce payload size
      const textContent = a.content.text?.substring(0, 30) || 'N/A';
      
      return `- Time: ${time} | App: ${appName} | Window: ${windowName || 'N/A'} | Text: ${textContent}`;
    })
    .join('\n');

  return `# Smart Reminder Analysis

## Activity Log
${activityLog}

## Analysis Task
Please analyze the user's app usage patterns to identify potential reminders they might need.
Focus on the following patterns:

1. Brief app interactions (less than 20 seconds in an app) that might indicate unfinished tasks
2. Quick switches between apps that suggest the user might have been interrupted
3. Opening apps that are typically used for specific tasks (banking, calendar, email, etc.) but only briefly

## Special Instructions for Window Names
- If the window name is specific and meaningful (like "Project Proposal" or "Invoice #1234"), use BOTH the app name AND window name in your analysis
- If the window name is generic or random text (like "New Tab" or random characters), focus primarily on the app name
- Always prioritize specific window names that suggest tasks or content

## Response Format
Please provide your analysis in the following structure:

### Reminder Suggestions
For each potential reminder, provide:
- Title: [Brief title for the reminder]
- Description: [Detailed description]
- App Name: [Associated application]
- Window Name: [Associated window, if meaningful]
- Should Remind: true/false (whether this should trigger a notification)

### General Insights
[Any broader patterns or insights about the user's app usage]`;
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
      suggestions,
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
