export interface ReminderSuggestion {
  title: string;
  description: string;
  appName: string;
  windowName?: string;
  shouldRemind: boolean;
  confidence: number;
  priority: 'low' | 'medium' | 'high';
}

export interface AIResponse {
  reminders: ReminderSuggestion[];
  insights: string[];
}

export interface AnalysisResponse {
  reminderSuggestions: ReminderSuggestion[];
  generalInsights: string[];
}
