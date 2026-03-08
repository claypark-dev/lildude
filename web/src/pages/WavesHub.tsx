/**
 * Shorebreak main layout.
 * Provides nested routing for the hub home, category pages, and installed waves.
 */

import { Outlet, NavLink, useLocation } from 'react-router-dom';

/** Tab item configuration. */
const HUB_TABS = [
  { label: 'Discover', path: '/hub' },
  { label: 'Community', path: '/hub/community' },
  { label: 'Installed', path: '/hub/installed' },
] as const;

/** Shorebreak layout with tabbed navigation and nested content. */
export function WavesHub() {
  const location = useLocation();

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Tab bar */}
      <div className="flex items-center gap-4 border-b border-[#222] pb-3">
        {HUB_TABS.map((tab) => {
          const isActive =
            tab.path === '/hub'
              ? location.pathname === '/hub' || location.pathname.startsWith('/hub/category')
              : tab.path === '/hub/community'
              ? location.pathname === '/hub/community' || location.pathname.startsWith('/hub/publish') || location.pathname.startsWith('/hub/author')
              : location.pathname === tab.path;

          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                isActive
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-[#ccc] hover:text-white'
              }`}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </div>

      {/* Nested route content */}
      <Outlet />
    </div>
  );
}
