/**
 * Category navigation tabs for the Waves Hub.
 * Horizontal scrollable tab bar with category names and wave counts.
 */

import type { WaveCategory } from './wave-hub-api.ts';

/** Props for the CategoryNav component. */
interface CategoryNavProps {
  categories: WaveCategory[];
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
}

/** Category tab navigation bar. */
export function CategoryNav({
  categories,
  activeCategory,
  onCategoryChange,
}: CategoryNavProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
      {/* "All" tab */}
      <button
        type="button"
        className={`px-4 py-2 text-sm rounded-lg whitespace-nowrap transition-colors ${
          activeCategory === null
            ? 'bg-blue-500/10 text-blue-400 font-medium'
            : 'bg-[#1a1a1a] text-[#ccc] hover:text-white hover:bg-[#222]'
        }`}
        onClick={() => onCategoryChange(null)}
      >
        All
      </button>

      {categories.map((cat) => (
        <button
          key={cat.name}
          type="button"
          className={`px-4 py-2 text-sm rounded-lg whitespace-nowrap transition-colors ${
            activeCategory === cat.name
              ? 'bg-blue-500/10 text-blue-400 font-medium'
              : 'bg-[#1a1a1a] text-[#ccc] hover:text-white hover:bg-[#222]'
          }`}
          onClick={() => onCategoryChange(cat.name)}
        >
          {cat.icon && <span className="mr-1">{cat.icon}</span>}
          {cat.displayName}
          {cat.waveCount > 0 && (
            <span className="ml-1.5 text-[10px] text-[#888]">
              ({cat.waveCount})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
