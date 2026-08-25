"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A slim animated bar at the very top of the viewport, mounted once in the
// root layout, so "something is happening" is visible at every navigation
// site-wide - not just the handful of pages with their own progress UI.
// No router-events API exists in the App Router, so this uses the same
// technique every dependency-free implementation of this pattern relies
// on: a capture-phase click listener starts the bar the instant an
// internal link is clicked (long before the destination has rendered),
// and the pathname/search-params changing signals the new route landed.
function Bar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [pct, setPct] = useState(0);
  const visibleRef = useRef(false);
  const trickleRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const hideRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function start() {
      clearTimeout(hideRef.current);
      clearInterval(trickleRef.current);
      visibleRef.current = true;
      setVisible(true);
      setPct(15);
      let p = 15;
      trickleRef.current = setInterval(() => {
        // Approach 90% asymptotically - real completion (route change)
        // always finishes the last stretch, so it never looks stuck at
        // an arbitrary number for a fast navigation.
        p += (90 - p) * 0.15;
        setPct(p);
      }, 180);
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearInterval(trickleRef.current);
      clearTimeout(hideRef.current);
    };
  }, []);

  const key = `${pathname}?${searchParams.toString()}`;
  const prevKey = useRef(key);
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    if (!visibleRef.current) return;
    clearInterval(trickleRef.current);
    setPct(100);
    hideRef.current = setTimeout(() => {
      visibleRef.current = false;
      setVisible(false);
      setPct(0);
    }, 220);
  }, [key]);

  return (
    <div
      role="progressbar"
      aria-label="Page loading"
      aria-hidden={!visible}
      aria-valuenow={visible ? Math.round(pct) : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]"
    >
      <div
        className={cx(
          "h-full bg-gradient-to-r from-lemon-500 via-lemon-400 to-lemon-300 shadow-[0_0_8px_rgba(163,230,53,0.6)] transition-[width,opacity] ease-out",
          visible ? "opacity-100" : "opacity-0",
          pct === 100 ? "duration-200" : "duration-300",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function RouteProgressBar() {
  // useSearchParams requires a Suspense boundary; a no-op fallback is fine
  // since the bar itself has nothing meaningful to show before hydration.
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
