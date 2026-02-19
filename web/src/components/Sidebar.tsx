import { NavLink } from 'react-router-dom';
import { useState } from 'react';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: '\u2302' },
  { label: 'Briefing', path: '/briefing', icon: '\u2600' },
  { label: 'Chat', path: '/chat', icon: '\u2709' },
  { label: 'Tasks', path: '/tasks', icon: '\u2611' },
  { label: 'Settings', path: '/settings', icon: '\u2699' },
];

/** Navigation sidebar with mobile toggle support */
export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        type="button"
        className="fixed top-4 left-4 z-50 md:hidden bg-slate-800 text-amber-400 p-2 rounded-lg"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle navigation"
      >
        {mobileOpen ? '\u2715' : '\u2630'}
      </button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMobileOpen(false);
          }}
          role="button"
          tabIndex={0}
          aria-label="Close navigation"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-slate-800 border-r border-slate-700
          flex flex-col z-40 transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:static md:z-auto
        `}
      >
        {/* Brand */}
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-xl font-bold text-amber-400 tracking-tight">
            Lil Dude
          </h1>
          <p className="text-xs text-slate-400 mt-1">AI Executive Assistant</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700">
          <p className="text-xs text-slate-500 text-center">v0.1.0</p>
        </div>
      </aside>
    </>
  );
}
