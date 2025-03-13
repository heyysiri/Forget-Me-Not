import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { ollama } from 'ollama-ai-provider';
import { pipe } from '@screenpipe/js';
import { ReminderSuggestion, AnalysisResponse, AIResponse } from '@/types/responses';

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
    // Improved JSON extraction pattern that handles more edge cases
    const jsonMatch = text.match(/(\{[\s\S]*\})/);
    
    if (!jsonMatch) {
      console.warn('Failed to find JSON structure in AI response');
      return { reminderSuggestions: [], generalInsights: [] };
    }

    let jsonString = jsonMatch[0];
    
    // Handle potential markdown code block wrapping
    if (jsonString.startsWith("```json") || jsonString.startsWith("```")) {
      jsonString = jsonString
        .replace(/^```json/, '')
        .replace(/^```/, '')
        .replace(/```$/, '')
        .trim();
    }
    
    try {
      const parsed = JSON.parse(jsonString) as AIResponse;
      
      // Create valid suggestions with more defensive checks
      const validSuggestions = ((parsed?.reminders || [])
        .filter(reminder => {
          if (!reminder) return false;
          
          // Add validation for description quality with null/undefined checks
          const hasGoodDescription = 
            reminder.description?.length > 20 && // Minimum length
            reminder.description !== reminder.title && // Not same as title
            reminder.description !== reminder.appName && // Not same as app name
            !String(reminder.description).includes('undefined') && // No undefined values
            (reminder.confidence === undefined || reminder.confidence >= 0.7); // Minimum confidence
            
          return hasGoodDescription;
        })
        .map(reminder => ({
          ...reminder,
          priority: reminder.priority || 'medium',
          // Add a timestamp to each reminder for display purposes
          createdAt: new Date().toISOString()
        })));

      return {
        reminderSuggestions: validSuggestions,
        generalInsights: (parsed?.insights?.filter(insight => 
          insight && typeof insight === 'string' && insight.length > 10
        ) || [])
      };
    } catch (innerError) {
      console.error('Failed to parse extracted JSON content:', innerError);
      console.log('Attempted to parse:', jsonString);
      return { reminderSuggestions: [], generalInsights: [] };
    }
  } catch (error) {
    console.error('Failed to extract JSON from AI response:', error);
    return { reminderSuggestions: [], generalInsights: [] };
  }
}

// 🛠 Handle AI-based reminder analysis
// Create a dedicated function for prompt creation
// Update the createAIPrompt function to limit data size

function createAIPrompt(activities: Activity[]): string {
  // Process activities to calculate durations and identify brief interactions
  const processedActivities: {
    appName: string;
    windowName: string;
    text: string;
    duration: number;
    visits: number;
    briefInteraction: boolean;
  }[] = [];
  const activityMap = new Map();
  
  // First pass to group by app+window
  activities.slice(-30).forEach(a => {
    const key = `${a.content.appName || 'Unknown'}-${a.content.windowName || 'N/A'}`;
    const timestamp = new Date(a.content.timestamp).getTime();
    
    if (!activityMap.has(key)) {
      activityMap.set(key, {
        appName: a.content.appName || 'Unknown',
        windowName: a.content.windowName || 'N/A',
        firstSeen: timestamp,
        lastSeen: timestamp,
        text: a.content.text?.substring(0, 30) || 'N/A',
        visits: 1
      });
    } else {
      const existing = activityMap.get(key);
      existing.lastSeen = timestamp;
      existing.visits += 1;
    }
  });
  
  // Convert to array and calculate duration
  activityMap.forEach((info, key) => {
    const duration = (info.lastSeen - info.firstSeen) / 1000; // in seconds
    processedActivities.push({
      appName: info.appName,
      windowName: info.windowName,
      text: info.text,
      duration: duration,
      visits: info.visits,
      briefInteraction: duration < 20 // Flag for brief interactions
    });
  });

  // Sort to prioritize brief interactions
  processedActivities.sort((a, b) => {
    if (a.briefInteraction && !b.briefInteraction) return -1;
    if (!a.briefInteraction && b.briefInteraction) return 1;
    return 0;
  });

  return `Analyze these activities and return a JSON object with actionable reminders. Focus primarily on brief interactions (less than 20 seconds) as these often represent incomplete tasks.

Required JSON Structure:
{
  "reminders": [
    {
      "title": "Brief action-oriented title",
      "description": "Detailed (but brief) description explaining why this needs attention and what action to take. Include context from the window name if relevant.",
      "appName": "string",
      "windowName": "string",
      "shouldRemind": boolean,
      "confidence": number (0.0-1.0),
      "priority": "low" | "medium" | "high"
    }
  ],
  "insights": [
    "Meaningful insights about user's activity patterns"
  ]
}

Guidelines for descriptions:
1. Must explain WHY this needs attention
2. Must suggest WHAT action to take
3. Must incorporate context from window names
4. Must be specific and actionable
5. For chat apps, mention the channel/conversation that needs follow-up
6. ONLY include apps with brief interactions (duration < 20 seconds) as reminders
7. IGNORE apps with longer interactions as they were likely completed tasks
8. Screenpipe is desktop app, so you may ignore it in reminders

Example bad description:
"Discord" (too vague, no context, not actionable)

Activities: ${JSON.stringify(processedActivities)}

Remember: Only include reminders for brief interactions (< 20 seconds), as these likely represent incomplete tasks that need follow-up. Always provide detailed, actionable descriptions.`;
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
    console.log(modelResponse);
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
