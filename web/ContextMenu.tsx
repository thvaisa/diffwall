// A minimal right-click context menu. One at a time: opening a new one closes
// any other via the shared module-level state each instance subscribes to.

import { useEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Hook: returns [menuState, openMenu, closeMenu]. Renders nothing itself —
 *  pair with <ContextMenuView> once per app (mounted in App.tsx). */
let setGlobalMenu: ((m: MenuState | null) => void) | null = null;

export function openContextMenu(
  e: React.MouseEvent,
  items: ContextMenuItem[],
): void {
  e.preventDefault();
  e.stopPropagation();
  setGlobalMenu?.({ x: e.clientX, y: e.clientY, items });
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setGlobalMenu = setMenu;
    return () => {
      setGlobalMenu = null;
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  if (!menu) return null;

  // Keep the menu on-screen if opened near the right/bottom edge.
  const maxX = window.innerWidth - 8;
  const maxY = window.innerHeight - 8;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: Math.min(menu.x, maxX - 160), top: Math.min(menu.y, maxY) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.items.map((item, i) => (
        <div
          key={i}
          className="context-menu-item"
          onClick={() => {
            item.onSelect();
            setGlobalMenu?.(null);
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
