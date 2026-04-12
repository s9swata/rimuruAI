export interface CalendarEvent {
  id: string;
  title: string;
  start: string;   // ISO 8601 string e.g. "2026-04-12T10:00:00Z"
  end: string;     // ISO 8601 string
  description: string;
}

export interface CalendarState {
  events: CalendarEvent[];
}
