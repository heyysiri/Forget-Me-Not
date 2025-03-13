export interface ReminderSuggestion {
  title: string;
  description: string;
  appName: string;
  windowName?: string;
  shouldRemind: boolean;
}

export interface AnalysisResponse {
  reminderSuggestions: ReminderSuggestion[];
  generalInsights: string[];
}
