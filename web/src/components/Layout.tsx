import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';

/** Main layout wrapper with sidebar and content area */
export function Layout() {
  return (
    <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
