import { useCallback } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { TaskList } from '../components/TaskList.tsx';
import { fetchTasks } from '../lib/api.ts';

/** Tasks page showing a list of recent tasks with status and cost */
export function Tasks() {
  const tasks = useApi(useCallback(() => fetchTasks(50), []));

  const totalCost = tasks.data?.tasks.reduce((sum, t) => sum + t.costUsd, 0) ?? 0;
  const taskCount = tasks.data?.tasks.length ?? 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Tasks</h2>
        <button
          type="button"
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
          onClick={tasks.refetch}
        >
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Total Tasks</p>
          <p className="text-2xl font-semibold text-white mt-1">{taskCount}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Total Cost</p>
          <p className="text-2xl font-semibold text-amber-400 mt-1">
            ${totalCost.toFixed(4)}
          </p>
        </div>
      </div>

      {/* Task list */}
      <section className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        {tasks.loading && <p className="text-slate-400 text-sm">Loading tasks...</p>}
        {tasks.error && <p className="text-red-400 text-sm">{tasks.error}</p>}
        {tasks.data && <TaskList tasks={tasks.data.tasks} />}
      </section>
    </div>
  );
}
