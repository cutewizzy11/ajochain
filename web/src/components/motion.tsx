"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

/** Fades/rises children in the first time they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`reveal ${inView ? "in" : ""} ${className}`} style={{ "--d": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

/** The logo as a loader: six members light up in turn while the circle slowly turns. */
export function Loader({ label, size = 44 }: { label?: string; size?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-4 py-20 page-in">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <g className="loader-ring">
          <circle cx="16" cy="16" r="11" fill="none" stroke="var(--line)" strokeWidth="1.2" />
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            return (
              <circle
                key={i}
                className="loader-dot"
                style={{ "--i": i } as CSSProperties}
                cx={16 + Math.cos(a) * 11}
                cy={16 + Math.sin(a) * 11}
                r={i === 0 ? 3 : 2.2}
                fill={i === 0 ? "var(--stamp)" : "var(--ink)"}
              />
            );
          })}
        </g>
      </svg>
      {label && <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>}
    </div>
  );
}

/** Counts a number up from 0 when it first mounts or changes. */
export function CountUp({ value, duration = 1100, format }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = reduce ? 1 : Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      const v = a + (value - a) * eased;
      setN(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  const isInt = Number.isInteger(value);
  return <>{format ? format(n) : isInt ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })}</>;
}

/** True once the page has scrolled past the threshold. */
export function useScrolled(threshold = 8) {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return s;
}
