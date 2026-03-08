/**
 * Surfwatch template presets.
 *
 * Each template defines which widgets to display and their order.
 * The Surfwatch page uses these to let users quickly switch between
 * curated layouts without manual configuration.
 */

/** A widget slot in a dashboard template. */
export interface TemplateWidget {
  /** Unique widget type key — must match the widget registry in Dashboard.tsx. */
  type: string;
  /** Display title for the widget card header. */
  title: string;
  /** Emoji icon for the widget card header. */
  icon: string;
  /** Column span (1 or 2) on wider screens. */
  span?: number;
}

/** A named dashboard template preset. */
export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  widgets: TemplateWidget[];
}

// ── Template Definitions ──────────────────────────────────────────

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'All widgets in a balanced layout',
    icon: '\uD83C\uDFE0',
    widgets: [
      { type: 'health', title: 'System Health', icon: '\u2665' },
      { type: 'budget', title: 'Budget', icon: '\uD83D\uDCB0' },
      { type: 'cost', title: 'Cost', icon: '\uD83D\uDCC8' },
      { type: 'tasks', title: 'Active Tasks', icon: '\u2611' },
      { type: 'clock', title: 'Clock', icon: '\u231A' },
      { type: 'quickchat', title: 'Quick Chat', icon: '\u2709' },
      { type: 'weather', title: 'Weather', icon: '\u2600\uFE0F' },
      { type: 'reminders', title: 'Reminders', icon: '\uD83D\uDD14' },
      { type: 'cron', title: 'Scheduled Jobs', icon: '\u23F0' },
      { type: 'heartbeat', title: 'Heartbeat', icon: '\uD83D\uDC93' },
    ],
  },
  {
    id: 'morning',
    name: 'Morning',
    description: 'Weather, reminders, and schedule at a glance',
    icon: '\uD83C\uDF05',
    widgets: [
      { type: 'clock', title: 'Clock', icon: '\u231A' },
      { type: 'weather', title: 'Weather', icon: '\u2600\uFE0F' },
      { type: 'reminders', title: 'Reminders', icon: '\uD83D\uDD14' },
      { type: 'cron', title: 'Scheduled Jobs', icon: '\u23F0' },
      { type: 'quickchat', title: 'Quick Chat', icon: '\u2709' },
      { type: 'budget', title: 'Budget', icon: '\uD83D\uDCB0' },
    ],
  },
  {
    id: 'ops',
    name: 'Ops',
    description: 'System health, costs, and infrastructure monitoring',
    icon: '\uD83D\uDCCA',
    widgets: [
      { type: 'health', title: 'System Health', icon: '\u2665' },
      { type: 'budget', title: 'Budget', icon: '\uD83D\uDCB0' },
      { type: 'cost', title: 'Cost', icon: '\uD83D\uDCC8' },
      { type: 'tasks', title: 'Active Tasks', icon: '\u2611' },
      { type: 'cron', title: 'Scheduled Jobs', icon: '\u23F0' },
      { type: 'heartbeat', title: 'Heartbeat', icon: '\uD83D\uDC93' },
    ],
  },
  {
    id: 'productivity',
    name: 'Productivity',
    description: 'Tasks, reminders, and quick actions',
    icon: '\uD83D\uDE80',
    widgets: [
      { type: 'tasks', title: 'Active Tasks', icon: '\u2611' },
      { type: 'reminders', title: 'Reminders', icon: '\uD83D\uDD14' },
      { type: 'cron', title: 'Scheduled Jobs', icon: '\u23F0' },
      { type: 'clock', title: 'Clock', icon: '\u231A' },
      { type: 'quickchat', title: 'Quick Chat', icon: '\u2709' },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials',
    icon: '\u2728',
    widgets: [
      { type: 'clock', title: 'Clock', icon: '\u231A' },
      { type: 'budget', title: 'Budget', icon: '\uD83D\uDCB0' },
      { type: 'quickchat', title: 'Quick Chat', icon: '\u2709' },
    ],
  },
];

/** Get a template by ID, or the default template. */
export function getTemplate(id: string): DashboardTemplate {
  return DASHBOARD_TEMPLATES.find((t) => t.id === id) ?? DASHBOARD_TEMPLATES[0];
}

/** LocalStorage key for saving the selected template ID. */
const TEMPLATE_STORAGE_KEY = 'lildude_dashboard_template';

/** Load the saved template ID from localStorage. */
export function getSavedTemplateId(): string {
  return localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? 'default';
}

/** Save the selected template ID to localStorage. */
export function saveTemplateId(id: string): void {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, id);
}
