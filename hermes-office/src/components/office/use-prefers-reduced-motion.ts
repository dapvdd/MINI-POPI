"use client";

import { useEffect, useState } from "react";

/**
 * One media-query subscription for the whole scene. When the user prefers
 * reduced motion, pose helpers collapse to a single stable frame so no
 * continuous oscillation reaches the render loop, and the DOM chrome (speech
 * bubble, thinking dots) drops its transitions.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}
