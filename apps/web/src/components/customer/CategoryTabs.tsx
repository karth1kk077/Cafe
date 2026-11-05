import { useEffect, useRef } from "react";

export interface CategoryTab {
  id: string;
  name: string;
}

/**
 * Horizontally scrolling category rail. Tapping jumps to the section; the
 * active chip follows the scroll position (scroll-spy lives in the page).
 */
export function CategoryTabs({
  categories,
  activeId,
  onSelect,
}: {
  categories: CategoryTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const railRef = useRef<HTMLElement>(null);

  // Keep the active chip visible without yanking the whole page.
  useEffect(() => {
    if (!activeId || !railRef.current) return;
    const chip = railRef.current.querySelector<HTMLElement>(`[data-category="${CSS.escape(activeId)}"]`);
    chip?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeId]);

  if (!categories.length) return null;

  return (
    <nav ref={railRef} aria-label="Menu categories" className="flex gap-2 overflow-x-auto bg-surface border-b border-line px-3 py-2 [scrollbar-width:none]">
      {categories.map((category) => {
        const active = category.id === activeId;
        return (
          <button
            key={category.id}
            type="button"
            data-category={category.id}
            aria-current={active ? "true" : undefined}
            className={`chip whitespace-nowrap ${active ? "!bg-espresso text-white" : "bg-cream text-espresso"}`}
            onClick={() => onSelect(category.id)}
          >
            {category.name}
          </button>
        );
      })}
    </nav>
  );
}
