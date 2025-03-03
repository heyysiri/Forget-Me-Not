"use client";

import { useEffect, useState, useRef } from "react";
import { pipe, ContentItem, ScreenpipeResponse as SDKScreenpipeResponse } from '@screenpipe/browser';
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Check, Clock, X, Play, Pause, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

// Define types
interface AppSwitchEvent {
  timestamp: string;
  appName: string;
  windowName: string;
}

interface ReminderItem {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  appContext?: {
    appName: string;
    windowName: string;
  };
  status: "pending" | "completed" | "dismissed";
}

interface Activity {
  content: {
    timestamp: string;
    appName?: string;
    windowName?: string;
    text?: string;
  };
}

interface Settings {
  aiProviderType: string;
  aiModel: string;
  aiUrl: string;
  openaiApiKey?: string;
  analysisFrequencyMin: number;
  notificationFrequencyMin: number;
}

const DEFAULT_ANALYSIS_FREQUENCY = 2; // 2 minutes
const DEFAULT_NOTIFICATION_FREQUENCY = 5; // 5 minutes
const LOCALSTORAGE_TODO_KEY = 'smart-reminder-todos';
const LOCALSTORAGE_SETTINGS_KEY = 'smart-reminder-settings';

const ANALYSIS_INTERVAL_MS = 60000; // Run AI analysis every 2 minutes
const FETCH_INTERVAL_MS = 10000;

export default function SmartReminderPage() {
  // App tracking state
  const [appHistory, setAppHistory] = useState<AppSwitchEvent[]>([]);
  const [lastCheckedTimestamp, setLastCheckedTimestamp] = useState<string | null>(null);
  const [todoList, setTodoList] = useState<ReminderItem[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [currentApp, setCurrentApp] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // AI analysis state
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  // const [pendingNotifications, setPendingNotifications] = useState<ReminderItem[]>([]);
  // const [nextNotificationTime, setNextNotificationTime] = useState<Date | null>(null);
  
  // Session tracking refs
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fetchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sessionStartTimeRef = useRef<string | null>(null);
  const activitiesQueueRef = useRef<Activity[]>([]);
  // const notificationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();

  // Load todos from localStorage on mount
  useEffect(() => {
    const savedTodos = localStorage.getItem(LOCALSTORAGE_TODO_KEY);
    if (savedTodos) {
      setTodoList(JSON.parse(savedTodos));
    }
  }, []);

  // Save todos to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_TODO_KEY, JSON.stringify(todoList));
  }, [todoList]);

  // Load settings from our server API with fallback
  useEffect(() => {
    async function loadSettings() {
      try {
        const savedSettings = localStorage.getItem(LOCALSTORAGE_SETTINGS_KEY);
        const defaultSettings = {
          aiProviderType: 'ollama',
          aiModel: 'llama2',
          aiUrl: 'http://localhost:11434/api/generate',
          analysisFrequencyMin: DEFAULT_ANALYSIS_FREQUENCY,
          notificationFrequencyMin: DEFAULT_NOTIFICATION_FREQUENCY
        };

        if (savedSettings) {
          setSettings(JSON.parse(savedSettings));
          return;
        }

        console.log("Smart Reminder: Loading settings from server API");
        const response = await fetch('/api/settings');
        
        if (!response.ok) {
          throw new Error(`Failed to load settings: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log("Smart Reminder: Settings loaded:", data);
        const mergedSettings = {
          ...defaultSettings,
          ...data
        };
        
        setSettings(mergedSettings);
        localStorage.setItem(LOCALSTORAGE_SETTINGS_KEY, JSON.stringify(mergedSettings));
      } catch (error) {
        console.error("Smart Reminder: Failed to load settings:", error);
        setErrorMessage("Failed to load settings. Using fallback settings.");
        
        // Use fallback settings when API fails
        setSettings({
          aiProviderType: 'ollama',
          aiModel: 'llama3',
          aiUrl: 'http://localhost:11434/api/generate',
          analysisFrequencyMin: DEFAULT_ANALYSIS_FREQUENCY,
          notificationFrequencyMin: DEFAULT_NOTIFICATION_FREQUENCY
        });
      } finally {
        setLoadingSettings(false);
      }
    }
    
    loadSettings();
  }, []);

  // Initialize Screenpipe SDK
  useEffect(() => {
    // Initialize Screenpipe SDK - remove the initialize call which doesn't exist
    const checkScreenpipeClient = async () => {
      try {
        console.log("Smart Reminder: Checking Screenpipe client");
        // The browser version doesn't have initialize() or getStatus()
        // It's automatically initialized when imported
        console.log("Smart Reminder: Screenpipe client ready");
      } catch (error) {
        console.error("Smart Reminder: Failed to check Screenpipe client:", error);
        setErrorMessage("Failed to initialize Screenpipe. Is the service running?");
      }
    };
    
    checkScreenpipeClient();
  }, []);

  // Cleanup intervals on component unmount
  useEffect(() => {
    return () => {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
      if (fetchIntervalRef.current) {
        clearInterval(fetchIntervalRef.current);
      }
      // if (notificationIntervalRef.current) {
      //   clearInterval(notificationIntervalRef.current);
      // }
    };
  }, []);

  // Replace checkScreenpipeStatus with a simpler version
  const checkScreenpipeStatus = async () => {
    try {
      // Make a simple query to check if Screenpipe is running
      const testQuery = await pipe.queryScreenpipe({
        contentType: "ocr",
        startTime: new Date(Date.now() - 10000).toISOString(), // 10 seconds ago
        endTime: new Date().toISOString(),
        limit: 1
      });
      console.log("Smart Reminder: Screenpipe test query successful");
      return true;
    } catch (error) {
      console.error("Smart Reminder: Failed to connect to Screenpipe:", error);
      return false;
    }
  };

  // Track isTracking persistently to prevent state update delays
const isTrackingRef = useRef(false);

const startTracking = async () => {
  console.log("Smart Reminder: startTracking function called");

  if (isTrackingRef.current) {
    console.log("Smart Reminder: Already tracking, ignoring request");
    return;
  }

  // Update both state and ref
  setIsTracking(true);
  isTrackingRef.current = true;

  let status;
  try {
    console.log("Smart Reminder: Checking Screenpipe status...");
    status = await checkScreenpipeStatus();
    console.log("Smart Reminder: Screenpipe status:", status);
  } catch (error) {
    console.error("Smart Reminder: Error checking Screenpipe status:", error);
    setIsTracking(false);
    isTrackingRef.current = false;
    return;
  }

  if (!status) {
    setIsTracking(false);
    isTrackingRef.current = false;
    setErrorMessage("Cannot connect to Screenpipe.");
    return;
  }

  console.log("Smart Reminder: Starting tracking session...");

  setAppHistory([]);
  setLastCheckedTimestamp(null);
  sessionStartTimeRef.current = new Date().toISOString();
  activitiesQueueRef.current = [];

  // await pipe.sendDesktopNotification({
  //   title: "Smart Reminder activated",
  //   body: "Monitoring your app usage to suggest helpful reminders.",
  // });

  // if ('Notification' in window && Notification.permission !== 'granted') {
  //   Notification.requestPermission();
  // }

  console.log("Smart Reminder: Setting up fetch intervals...");

  if (!fetchIntervalRef.current) {
    fetchIntervalRef.current = setInterval(() => {
      console.log("Smart Reminder: Fetching activity...");
      fetchAppActivity();
    }, FETCH_INTERVAL_MS);
  }

  console.log("Smart Reminder: Triggering immediate fetch...");
  setTimeout(() => {
    console.log("Smart Reminder: Running first fetch after delay...");
    fetchAppActivity();
  }, 1000);

  if (!analysisIntervalRef.current) {
    analysisIntervalRef.current = setInterval(() => {
      if (activitiesQueueRef.current.length > 0) {
        console.log(`Smart Reminder: Running AI analysis on ${activitiesQueueRef.current.length} activities`);
        analyzeAppUsage([...activitiesQueueRef.current]);
        activitiesQueueRef.current = [];
      } else {
        console.log("Smart Reminder: No new activities to analyze");
      }
    }, (settings?.analysisFrequencyMin ?? DEFAULT_ANALYSIS_FREQUENCY) * 60 * 1000);
  }

  // if (!notificationIntervalRef.current) {
  //   const nextTime = new Date(Date.now() + (settings?.notificationFrequencyMin || DEFAULT_NOTIFICATION_FREQUENCY) * 60 * 1000);
  //   setNextNotificationTime(nextTime);
  //   console.log(`Smart Reminder: First notification batch scheduled for ${nextTime.toLocaleTimeString()}`);

  //   notificationIntervalRef.current = setInterval(() => {
  //     if (pendingNotifications.length > 0) {
  //       showBatchNotification();
  //     } else {
  //       // Update next notification time even when there are no notifications
  //       const nextTime = new Date(Date.now() + (settings?.notificationFrequencyMin || DEFAULT_NOTIFICATION_FREQUENCY) * 60 * 1000);
  //       setNextNotificationTime(nextTime);
  //       console.log(`Smart Reminder: No notifications to show. Next check at ${nextTime.toLocaleTimeString()}`);
  //     }
  //   }, settings?.notificationFrequencyMin * 60 * 1000 || DEFAULT_NOTIFICATION_FREQUENCY * 60 * 1000);
  // }
};

const stopTracking = async () => {
  if (!isTrackingRef.current) return;

  console.log("Smart Reminder: Stopping tracking session");
  setIsTracking(false);
  isTrackingRef.current = false;
  sessionStartTimeRef.current = null;

  if (analysisIntervalRef.current) {
    clearInterval(analysisIntervalRef.current);
    analysisIntervalRef.current = null;
  }

  if (fetchIntervalRef.current) {
    clearInterval(fetchIntervalRef.current);
    fetchIntervalRef.current = null;
  }

  // if (notificationIntervalRef.current) {
  //   clearInterval(notificationIntervalRef.current);
  //   notificationIntervalRef.current = null;
  //   setNextNotificationTime(null);
  //   console.log("Smart Reminder: Notification schedule cleared");
  // }

  // await pipe.sendDesktopNotification({
  //   title: "Smart Reminder deactivated",
  //   body: "App usage monitoring paused. Your to-do list remains available.",
  // });
};

const fetchAppActivity = async () => {
  console.log("Smart Reminder: Fetch activity called");
  console.log("Smart Reminder: isTracking =", isTrackingRef.current);
  console.log("Smart Reminder: sessionStartTimeRef.current =", sessionStartTimeRef.current);

  if (!isTrackingRef.current || !sessionStartTimeRef.current) {
    console.log("Smart Reminder: Skipping fetch as tracking is not active");
    return;
  }

  try {
    const now = new Date().toISOString();
    const startTime = lastCheckedTimestamp || sessionStartTimeRef.current;
    
    console.log(`Smart Reminder: Fetching activity from ${startTime} to ${now}`);

    const results = await pipe.queryScreenpipe({
      contentType: "ocr",
      startTime,
      endTime: now,
      limit: 50,
    });

    if (!results?.data || !Array.isArray(results.data) || results.data.length === 0) {
      console.log("Smart Reminder: No new data found");
      setLastCheckedTimestamp(now);
      return;
    }

    console.log(`Smart Reminder: Found ${results.data.length} new events`);

    const activities: Activity[] = results.data.map(item => ({
      content: {
        timestamp: item.content.timestamp,
        appName: 'appName' in item.content ? item.content.appName : '',
        windowName: 'windowName' in item.content ? item.content.windowName : '', // Ensure windowName exists
        text: 'text' in item.content ? item.content.text : undefined
      }
    }));

    activitiesQueueRef.current = [...activitiesQueueRef.current, ...activities];

    const appEvents = extractAppEvents(results.data);
    if (appEvents.length > 0) {
      setAppHistory(prev => {
        const combined = [...prev, ...appEvents];
        return combined.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      });

      appEvents.forEach(event => {
        logAppSwitch(event);
      });
    }

    updateCurrentAppFromResults(results);
    setLastCheckedTimestamp(now);
  } catch (error) {
    console.error("Smart Reminder: Error fetching app activity:", error);
    setErrorMessage("Failed to connect to Screenpipe API. Is the service running?");
    toast({
      title: "Connection Error",
      description: "Failed to connect to Screenpipe API. Is the service running?",
      variant: "destructive",
      duration: 5000,
    });
  }
};

// Log app switch to our logs API - update this function
// Update in page.tsx
const logAppSwitch = async (event: AppSwitchEvent) => {
  try {
    if (!event || !event.appName || !event.timestamp) {
      console.error('Smart Reminder: Invalid event data for logging:', event);
      return;
    }
    
    const logData = {
      timestamp: new Date(event.timestamp).getTime(),
      app: event.appName,
      windowName: event.windowName || ''
    };
    
    console.log("Smart Reminder: Logging app switch:", logData);
    
    const response = await fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(logData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to log app switch:', response.status, errorText);
    }
  } catch (error) {
    console.error('Error logging app switch:', error);
  }
};

  // Extract app events from raw data
  // Update in page.tsx
const extractAppEvents = (data: any[]): AppSwitchEvent[] => {
  console.log("Smart Reminder: Extracting app events from data");
  console.log("Smart Reminder: Raw data received:", JSON.stringify(data.slice(0, 2), null, 2)); // Log first 2 items
  
  const appEvents: AppSwitchEvent[] = [];
  
  // Sort data by timestamp to ensure chronological processing
  const sortedData = [...data].sort((a, b) => {
    const aTime = new Date((a.content?.timestamp || 0).toString()).getTime();
    const bTime = new Date((b.content?.timestamp || 0).toString()).getTime();
    console.log(`Comparing timestamps: ${a.content?.timestamp} vs ${b.content?.timestamp}`);
    return aTime - bTime;
  });
  
  sortedData.forEach((item, index) => {
    console.log(`Processing item ${index}:`, {
      hasContent: !!item.content,
      timestamp: item.content?.timestamp,
      appName: item.content?.appName,
      windowName: item.content?.windowName || item.content?.window_name
    });

    if (item.content && item.content.timestamp && item.content.appName) {
      // Ensure timestamp is a valid string that can be parsed
      let timestamp: string;
      try {
        timestamp = new Date(item.content.timestamp).toISOString();
        
        appEvents.push({
          timestamp: timestamp,
          appName: item.content.appName,
          windowName: item.content.windowName || item.content.window_name || ""
        });
        
        console.log("Smart Reminder: Successfully extracted event:", {
          timestamp,
          appName: item.content.appName,
          windowName: item.content.windowName || item.content.window_name || ""
        });
      } catch (e) {
        console.error("Smart Reminder: Invalid timestamp for item:", item.content.timestamp, e);
      }
    } else {
      console.log("Smart Reminder: Skipping invalid app event data, missing required fields:", {
        hasContent: !!item.content,
        hasTimestamp: !!item.content?.timestamp,
        hasAppName: !!item.content?.appName
      });
    }
  });
  
  console.log(`Smart Reminder: Extracted ${appEvents.length} valid app events`);
  return appEvents;
};

  // Update current app from latest data
  const updateCurrentAppFromResults = (results: any) => {
    if (!results?.data || !Array.isArray(results.data) || results.data.length === 0) {
      return;
    }
    
    // Find the most recent entry
    const sorted = [...results.data].sort((a, b) => {
      const aTime = new Date(a.content.timestamp).getTime();
      const bTime = new Date(b.content.timestamp).getTime();
      return bTime - aTime; // Sort descending to get latest first
    });
    
    const latest = sorted[0];
    const appName = latest.content.appName || '';
      
    if (appName && appName !== currentApp) {
      console.log(`Smart Reminder: Current app changed to ${appName}`);
      setCurrentApp(appName);
    }
  };

  // Analyze app usage with AI
const analyzeAppUsage = async (activities: Activity[]) => {
  if (!settings) {
    console.error("Smart Reminder: Settings not available");
    return;
  }

  console.log(`Smart Reminder: Analyzing ${activities.length} activities using AI`);
  
  // Limit to maximum 20 activities to prevent payload size issues
  const limitedActivities = activities.length > 50 
    ? activities.slice(-50) 
    : activities;
  
  if (activities.length > 50) {
    console.log(`Smart Reminder: Limited to ${limitedActivities.length} most recent activities to prevent payload size issues`);
  }
  
  // Log the activity data we're sending to AI
  console.log("Smart Reminder: Activity log for AI analysis:");
  limitedActivities.forEach((activity, index) => {
    const time = new Date(activity.content.timestamp).toLocaleTimeString();
    const appName = activity.content.appName || 'Unknown';
    const windowName = activity.content.windowName || '';
    
    console.log(
      `  ${index + 1}. [${time}] App: ${appName} | Window: ${windowName || 'N/A'} | ` + 
      `Text: ${activity.content.text?.substring(0, 30) ?? ''}${(activity.content.text?.length ?? 0) > 30 ? '...' : ''}`
    );
  });
  
  try {
    // Create the prompt for AI analysis
    const prompt = createAIPrompt(limitedActivities);
    
    // Send to our custom API endpoint for reminder analysis
    const response = await fetch('/api/analyze-reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        activities: limitedActivities,
        prompt
      }),
    });

    if (!response.ok) {
      throw new Error(`AI analysis failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log("Smart Reminder: Received AI analysis:", data.analysis);
    
    // Update the AI analysis state
    setAiAnalysis(data.analysis);
    
    // Process suggestions from AI
    if (data.suggestions && Array.isArray(data.suggestions)) {
      console.log("Smart Reminder: Processing AI suggestions:", data.suggestions);
      
      data.suggestions.forEach((suggestion: any) => {
        if (suggestion.shouldRemind) {
          showSuggestionNotification(
            suggestion.title, 
            suggestion.description,
            suggestion.appName,
            suggestion.windowName
          );
        }
      });
    } else {
      // Fallback if suggestions aren't provided by the API
      const suggestions = extractSuggestionsFromAnalysis(data.analysis);
      suggestions.forEach(suggestion => {
        if (suggestion.shouldNotify) {
          showSuggestionNotification(
            suggestion.title, 
            suggestion.description,
            suggestion.appName
          );
        }
      });
    }
    
  } catch (error) {
    console.error("Smart Reminder: Error analyzing app usage:", error);
    setErrorMessage("Failed to analyze app usage patterns");
  }
};

// Create a helper function to format the prompt for AI analysis
const createAIPrompt = (activities: Activity[]): string => {
  // Format activity log for the prompt
  const activityLog = activities
    .map((a) => {
      const time = new Date(a.content.timestamp).toLocaleTimeString();
      const windowName = a.content.windowName || '';
      const appName = a.content.appName || 'Unknown';
      
      return `- Time: ${time} | App: ${appName} | Window: ${windowName || 'N/A'} | Text: ${a.content.text?.substring(0, 50) || 'N/A'}`;
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
};
  
  // Extract suggestion notifications from AI analysis text
  const extractSuggestionsFromAnalysis = (analysis: string): { 
    title: string;
    description: string;
    shouldNotify: boolean;
    appName?: string;
  }[] => {
    console.log("Smart Reminder: Extracting suggestions from analysis text");
    const suggestions = [];
    
    // Try to find reminder suggestions in the AI response
    const reminderSectionRegex = /reminder suggestions:?[\s\S]*?(?=general insights:|$)/i;
    const reminderSection = reminderSectionRegex.exec(analysis)?.[0] || "";
    
    // If we found a reminder section, extract each reminder
    if (reminderSection) {
      // Look for patterns like "App Name: Calendar" or similar
      const appNameRegex = /app name:?\s*([A-Za-z0-9\s]+)/gi;
      let appNameMatch;
      
      while ((appNameMatch = appNameRegex.exec(reminderSection)) !== null) {
        // Get the app name
        const appName = appNameMatch[1].trim();
        
        // Try to find a title and description near this app name
        const contextStart = Math.max(0, appNameMatch.index - 200);
        const contextEnd = Math.min(reminderSection.length, appNameMatch.index + 200);
        const context = reminderSection.substring(contextStart, contextEnd);
        
        const titleMatch = /title:?\s*([^\n]+)/i.exec(context);
        const descMatch = /description:?\s*([^\n]+)/i.exec(context);
        
        if (titleMatch && descMatch) {
          suggestions.push({
            title: titleMatch[1].trim(),
            description: descMatch[1].trim(),
            shouldNotify: true,
            appName
          });
        }
      }
    }
    
    // If no structured reminders were found, look for any mentions of brief app usage
    if (suggestions.length === 0) {
      const briefUsageRegex = /(briefly|quickly) (used|opened|checked|visited) ([A-Za-z0-9\s]+)/gi;
      let match;
      
      while ((match = briefUsageRegex.exec(analysis)) !== null) {
        const action = match[1];  // briefly/quickly
        const verb = match[2];    // used/opened/etc
        const appName = match[3]; // app name
        
        suggestions.push({
          title: `Quick ${appName} check detected`,
          description: `You ${action} ${verb} ${appName}. Need to return to it later?`,
          shouldNotify: true,
          appName
        });
      }
    }
    
    return suggestions;
  };
  
  // Show notification with suggestion
  const showSuggestionNotification = async (title: string, description: string, appName?: string, windowName?: string) => {
    // Generate a unique ID for this reminder
    const id = `reminder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Check if window name is meaningful (not just random text or empty)
    const isWindowNameMeaningful = windowName && 
      windowName.trim() !== "" && 
      !(/^[a-f0-9]{8}-[a-f0-9]{4}/.test(windowName)) && // Not a UUID
      windowName.length < 50; // Not excessively long random text
    
    // Create the reminder
    const newReminder: ReminderItem = {
      id,
      title,
      description,
      createdAt: new Date().toISOString(),
      appContext: {
        appName: appName || 'Unknown app',
        windowName: isWindowNameMeaningful ? windowName : ''
      },
      status: "pending"
    };
    
    // Add to todo list
    setTodoList(prev => [...prev, newReminder]);
    
    // Add to pending notifications
    // setPendingNotifications(prev => [...prev, newReminder]);

    // await pipe.sendDesktopNotification({
    //   title: title,
    //   body: description,
    // });
  };

  // Add a reminder to the todo list
  const addToTodoList = async (title: string, description: string, appName?: string) => {
    console.log(`Smart Reminder: Adding to todo list - ${title}`);
    
    const newTodo: ReminderItem = {
      id: `todo-${Date.now()}`,
      title,
      description,
      createdAt: new Date().toISOString(),
      appContext: appName ? {
        appName,
        windowName: ''
      } : undefined,
      status: "pending"
    };
    
    setTodoList(prev => [...prev, newTodo]);
    
    // await pipe.sendDesktopNotification({
    //   title: "Added to your to-do list",
    //   body: "A new reminder has been added to your list.",
    // });
  };

  // Handle dismissal of a reminder suggestion
  const dismissReminder = async () => {
    console.log("Smart Reminder: Dismissing reminder");
    
    // await pipe.sendDesktopNotification({
    //   title: "Reminder dismissed",
    //   body: "This suggestion won't appear again.",
    // });
  };

  // Request notification permissions
  // const requestNotificationPermission = async () => {
  //   console.log("Smart Reminder: Requesting notification permission");
    
  //   if ('Notification' in window) {
  //     const permission = await Notification.requestPermission();
      
  //     if (permission === 'granted') {
  //       console.log("Smart Reminder: Notification permission granted");
  //       await pipe.sendDesktopNotification({
  //         title: "Notifications enabled",
  //         body: "You'll now receive desktop notifications for app usage reminders.",
  //       });
  //     } else {
  //       console.log("Smart Reminder: Notification permission denied");
  //       await pipe.sendDesktopNotification({
  //         title: "Notification permission denied",
  //         body: "Please enable notifications to receive reminders.",
  //       });
  //     }
  //   }
  // };

  // Mark a todo item as completed
  const markAsCompleted = async (id: string) => {
    console.log(`Smart Reminder: Marking todo item as completed - ${id}`);
    
    setTodoList(prev => 
      prev.map(item => 
        item.id === id ? { ...item, status: "completed" } : item
      )
    );
    
    // await pipe.sendDesktopNotification({
    //   title: "Task completed",
    //   body: "Great job! The reminder has been marked as done.",
    // });
  };

  // Delete a todo item
  const deleteTodoItem = async (id: string) => {
    console.log(`Smart Reminder: Deleting todo item - ${id}`);
    
    setTodoList(prev => prev.filter(item => item.id !== id));
    
    // await pipe.sendDesktopNotification({
    //   title: "Reminder removed",
    //   body: "The reminder has been deleted from your list.",
    // });
  };

  // Effect to request notification permissions on component mount
  useEffect(() => {
    console.log("Smart Reminder: Initializing component");
    // requestNotificationPermission();
  }, []);

  useEffect(() => {
    console.log("Smart Reminder: isTracking state changed to:", isTracking);
  }, [isTracking]);

  // Add this new function to show batched notifications
  // const showBatchNotification = async () => {
  //   if (pendingNotifications.length === 0) return;

  //   const count = pendingNotifications.length;
  //   const description = pendingNotifications
  //     .map(item => `• ${item.title}`)
  //     .join('\n');

  //   await pipe.sendDesktopNotification({
  //     title: `${count} new task${count > 1 ? 's' : ''} generated`,
  //     body: description,
  //   });

  //   // Clear pending notifications
  //   setPendingNotifications([]);

  //   // Update next notification time
  //   const nextTime = new Date(Date.now() + (settings?.notificationFrequencyMin || DEFAULT_NOTIFICATION_FREQUENCY) * 60 * 1000);
  //   setNextNotificationTime(nextTime);
  //   console.log(`Smart Reminder: Next notification batch scheduled for ${nextTime.toLocaleTimeString()}`);
  // };

  // Add these new functions to handle settings updates
  const updateAnalysisFrequency = (value: number[]) => {
    if (!settings) return;
    const newSettings = {
      ...settings,
      analysisFrequencyMin: value[0]
    };
    setSettings(newSettings);
    localStorage.setItem(LOCALSTORAGE_SETTINGS_KEY, JSON.stringify(newSettings));
  };

  const updateNotificationFrequency = (value: number[]) => {
    if (!settings) return;
    const newSettings = {
      ...settings,
      notificationFrequencyMin: value[0]
    };
    setSettings(newSettings);
    localStorage.setItem(LOCALSTORAGE_SETTINGS_KEY, JSON.stringify(newSettings));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Smart Reminder</CardTitle>
          <div className="flex items-center mt-2 bg-gradient-to-r from-purple-100 to-indigo-100 p-2 rounded-md">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 mr-2 text-purple-600">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-sm text-purple-700">
              Works best with Ollama running <span className="font-semibold">llama3</span> or <span className="font-semibold">llama3.2</span>
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-medium">App Usage Monitor</h2>
              <p className="text-sm text-gray-500">
                {isTracking ? 'Actively monitoring app usage' : 'Monitor your app usage for timely reminders'}
              </p>
            </div>
            <div className="flex space-x-2">
              {!isTracking ? (
                <Button 
                  variant="default" 
                  onClick={startTracking}
                  className="bg-green-600 hover:bg-green-700"
                  disabled={loadingSettings || !settings}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start Analyzing
                </Button>
              ) : (
                <Button 
                  variant="outline" 
                  onClick={stopTracking}
                  className="border-red-500 text-red-500 hover:bg-red-50 hover:text-red-600"
                >
                  <Pause className="w-4 h-4 mr-2" />
                  Stop Analyzing
                </Button>
              )}
              {isTracking && (
                <Button 
                  variant="outline" 
                  onClick={() => {
                    console.log("Manual fetch trigger");
                    fetchAppActivity(); 
                  }}
                  className="ml-2"
                >
                  Test Fetch
                </Button>
              )}
            </div>
          </div>
          
          {loadingSettings && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md flex items-center">
              <AlertCircle className="text-blue-600 w-5 h-5 mr-2" />
              <p className="text-sm text-blue-700">
                Loading your settings...
              </p>
            </div>
          )}
          
          {settings && !loadingSettings && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md flex items-center">
              <AlertCircle className="text-blue-600 w-5 h-5 mr-2" />
              <p className="text-sm text-blue-700">
                AI Provider: {settings.aiProviderType} | Model: {settings.aiModel}
              </p>
            </div>
          )}
          
          {isTracking && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md flex items-center">
              <AlertCircle className="text-green-600 w-5 h-5 mr-2" />
              <p className="text-sm text-green-700">
                Actively monitoring app usage. AI will analyze .
              </p>
            </div>
          )}
          
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-center">
              <AlertCircle className="text-red-600 w-5 h-5 mr-2" />
              <p className="text-sm text-red-700">
                {errorMessage}
              </p>
            </div>
          )}
          
          {currentApp && (
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">Current App:</span>
              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                {currentApp}
              </span>
            </div>
          )}
          {/* {isTracking && nextNotificationTime && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md flex items-center">
              <Clock className="text-blue-600 w-5 h-5 mr-2" />
              <p className="text-sm text-blue-700">
                Next notification batch scheduled for: {nextNotificationTime.toLocaleTimeString()}
              </p>
            </div>
          )} */}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Analysis Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Analysis Frequency (minutes)</Label>
            <Slider
              defaultValue={[settings?.analysisFrequencyMin || DEFAULT_ANALYSIS_FREQUENCY]}
              max={10}
              min={1}
              step={1}
              onValueChange={updateAnalysisFrequency}
            />
            <p className="text-sm text-gray-500">
              AI will analyze your activity every {settings?.analysisFrequencyMin || DEFAULT_ANALYSIS_FREQUENCY} minutes
            </p>
          </div>
          
          {/* <div className="space-y-2">
            <Label>Notification Frequency (minutes)</Label>
            <Slider
              defaultValue={[settings?.notificationFrequencyMin || DEFAULT_NOTIFICATION_FREQUENCY]}
              max={15}
              min={1}
              step={1}
              onValueChange={updateNotificationFrequency}
            />
            <p className="text-sm text-gray-500">
              You'll receive batched notifications every {settings?.notificationFrequencyMin || DEFAULT_NOTIFICATION_FREQUENCY} minutes
            </p>
          </div> */}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Clock className="w-5 h-5 mr-2" />
            Your To-Do List
            <span className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded-full">
              {todoList.filter(item => item.status !== "completed").length} pending
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {todoList.length > 0 ? (
            <ul className="space-y-2">
              {todoList.map(item => (
                <li 
                  key={item.id}
                  className={`p-3 border rounded-lg flex justify-between items-center ${
                    item.status === "completed" ? "bg-gray-50 text-gray-500" : "bg-white"
                  }`}
                >
                  <div>
                    <p className={`font-medium ${item.status === "completed" ? "line-through" : ""}`}>
                      {item.title}
                    </p>
                    <p className="text-sm text-gray-600">{item.description}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {item.appContext?.appName && (
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                          App: {item.appContext.appName}
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-800 rounded-full">
                        {new Date(item.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => markAsCompleted(item.id)}
                      disabled={item.status === "completed"}
                      className="text-green-600 hover:text-green-700 hover:bg-green-50"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => deleteTodoItem(item.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center border border-dashed rounded-lg">
              <p className="text-gray-500">No reminders yet. They will appear here when you create them.</p>
              {!isTracking && !loadingSettings && settings && (
                <Button 
                  variant="outline" 
                  className="mt-4" 
                  onClick={startTracking}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start Analyzing
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* {aiAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle>AI Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line">{aiAnalysis}</p>
          </CardContent>
        </Card>
      )} */}
    </div>
  );
}