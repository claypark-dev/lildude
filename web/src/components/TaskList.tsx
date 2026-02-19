import type { Task } from '../lib/types.ts';

interface TaskListProps {
  tasks: Task[];
}

const STATUS_STYLES: Record<Task['status'], string> = {
  completed: 'bg-green-500/20 text-green-400',
  running: 'bg-yellow-500/20 text-yellow-400',
  pending: 'bg-slate-500/20 text-slate-400',
  failed: 'bg-red-500/20 text-red-400',
};

/** Renders a list of tasks with status badges and cost */
export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className="text-slate-500 text-sm py-4 text-center">
        No tasks yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700"
        >
          <div className="flex-1 min-w-0 mr-3">
            <p className="text-sm text-white truncate">{task.description}</p>
            <p className="text-xs text-slate-500 mt-1">
              {new Date(task.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-slate-400">
              ${task.costUsd.toFixed(4)}
            </span>
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[task.status]}`}
            >
              {task.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
