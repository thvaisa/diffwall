// Middle-click autoscroll, like browsers/IDEs: press the middle mouse button on
// a scrollable pane body to enter autoscroll mode; the element then scrolls at a
// speed proportional to how far the cursor is from the press point. Any click
// exits. Returns a ref to attach to the scroll container.

import { useEffect, useRef } from "react";

export function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let active = false;
    let originX = 0;
    let originY = 0;
    let curX = 0;
    let curY = 0;
    let raf = 0;
    let marker: HTMLDivElement | null = null;

    const tick = () => {
      if (!active) return;
      const dy = curY - originY;
      const dx = curX - originX;
      // Dead zone near the origin; speed scales with distance beyond it.
      const dead = 12;
      const scale = 0.18;
      const vy = Math.abs(dy) > dead ? (dy - Math.sign(dy) * dead) * scale : 0;
      const vx = Math.abs(dx) > dead ? (dx - Math.sign(dx) * dead) * scale : 0;
      if (vy) el.scrollTop += vy;
      if (vx) el.scrollLeft += vx;
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onAnyDown, true);
      window.removeEventListener("keydown", onKey, true);
      if (marker) {
        marker.remove();
        marker = null;
      }
    };

    const onMove = (e: MouseEvent) => {
      curX = e.clientX;
      curY = e.clientY;
    };
    const onAnyDown = () => stop(); // any further click cancels
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return; // middle button only
      // Only start if there is something to scroll.
      if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)
        return;
      e.preventDefault();
      if (active) {
        stop();
        return;
      }
      active = true;
      originX = curX = e.clientX;
      originY = curY = e.clientY;

      // A small on-screen origin marker so the mode is obvious.
      marker = document.createElement("div");
      marker.className = "autoscroll-marker";
      marker.style.left = `${e.clientX - 11}px`;
      marker.style.top = `${e.clientY - 11}px`;
      document.body.appendChild(marker);

      window.addEventListener("mousemove", onMove);
      // Capture so the cancelling click doesn't also do something else first.
      window.addEventListener("mousedown", onAnyDown, true);
      window.addEventListener("keydown", onKey, true);
      raf = requestAnimationFrame(tick);
    };

    el.addEventListener("mousedown", onMouseDown);
    // Suppress the OS "middle-click paste / scroll" default inside the pane.
    const onAux = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("auxclick", onAux);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("auxclick", onAux);
      stop();
    };
  }, []);

  return ref;
}
