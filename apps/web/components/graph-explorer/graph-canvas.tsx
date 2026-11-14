"use client";
// The graph, drawn in SVG inside its own box: drag the background to pan, scroll or pinch to zoom (or the buttons, or
// the keyboard: arrows, + and -, 0 to fit), drag a node to move it, hover to light up its neighbours, tap or click to
// open it. The page around it scrolls as usual; only the box takes the gestures.
import { Maximize, Minus, Plus } from "lucide-react";
import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { type GraphEdge, type GraphNode, KIND_COLOR } from "../../server/hub/graph-model.ts";
import type { Point } from "./layout.ts";

export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 6;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
// How far a press can move and still be a tap.
const TAP_SLOP = 4;
// Labels always drawn when nothing is in focus: the biggest nodes.
const LABELS_AT_REST = 24;

type Gesture =
  | { type: "pan"; start: Point; view: View; moved: boolean }
  | { type: "pinch"; dist: number; mid: Point; view: View }
  | { type: "drag"; id: string; start: Point; moved: boolean };

export function zoomAt(view: View, at: Point, factor: number): View {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

export function GraphCanvas({
  nodes,
  edges,
  positions,
  radius,
  view,
  onView,
  onMove,
  focus,
  selected,
  onHover,
  onSelect,
  onFit,
  onSize,
  label,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Map<string, Point>;
  radius: Map<string, number>;
  view: View;
  onView: (view: View | ((prev: View) => View)) => void;
  onMove: (id: string, at: Point) => void;
  // The node lit up (hovered, else selected) and its neighbours.
  focus: { id: string; lit: Set<string> } | null;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onFit: () => void;
  onSize: (size: { w: number; h: number }) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const report = () => onSize({ w: el.clientWidth, h: el.clientHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onSize]);

  const local = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = svg.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  // Wheel zoom needs a listener that may cancel the page's scroll.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0018;
      onView((v) => zoomAt(v, local(e), Math.exp(-e.deltaY * step)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [onView, local]);

  const startPinch = useCallback(() => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    gesture.current = {
      type: "pinch",
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: viewRef.current,
    };
  }, []);

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    svg.current?.setPointerCapture(e.pointerId);
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    if (pointers.current.size === 2) startPinch();
    else if (pointers.current.size === 1)
      gesture.current = { type: "pan", start: at, view: viewRef.current, moved: false };
  };

  const onNodeDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, id: string) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.stopPropagation();
      svg.current?.setPointerCapture(e.pointerId);
      const at = local(e);
      pointers.current.set(e.pointerId, at);
      if (pointers.current.size === 2) startPinch();
      else gesture.current = { type: "drag", id, start: at, moved: false };
    },
    [local, startPinch],
  );

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clampZoom(g.view.k * (dist / g.dist));
      const world = { x: (g.mid.x - g.view.x) / g.view.k, y: (g.mid.y - g.view.y) / g.view.k };
      onView({ k, x: mid.x - world.x * k, y: mid.y - world.y * k });
      return;
    }
    const dx = at.x - g.start.x;
    const dy = at.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
    if (!g.moved) return;
    if (g.type === "pan") onView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    else {
      const v = viewRef.current;
      onMove(g.id, { x: (at.x - v.x) / v.k, y: (at.y - v.y) / v.k });
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (e.type === "pointerup" && g && g.type !== "pinch" && !g.moved) onSelect(g.type === "drag" ? g.id : null);
    if (pointers.current.size === 1 && g?.type === "pinch") {
      const [rest] = [...pointers.current.values()];
      gesture.current = rest ? { type: "pan", start: rest, view: viewRef.current, moved: true } : null;
    } else if (!pointers.current.size) gesture.current = null;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const middle = { x: (box.current?.clientWidth ?? 0) / 2, y: (box.current?.clientHeight ?? 0) / 2 };
    const pan = (x: number, y: number) => onView((v) => ({ ...v, x: v.x + x, y: v.y + y }));
    const zoom = (factor: number) => onView((v) => zoomAt(v, middle, factor));
    switch (e.key) {
      case "ArrowLeft":
        pan(48, 0);
        break;
      case "ArrowRight":
        pan(-48, 0);
        break;
      case "ArrowUp":
        pan(0, 48);
        break;
      case "ArrowDown":
        pan(0, -48);
        break;
      case "+":
      case "=":
        zoom(1.25);
        break;
      case "-":
        zoom(0.8);
        break;
      case "0":
        onFit();
        break;
      case "Escape":
        onSelect(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const zoomButton = (factor: number) => () => {
    const middle = { x: (box.current?.clientWidth ?? 0) / 2, y: (box.current?.clientHeight ?? 0) / 2 };
    onView((v) => zoomAt(v, middle, factor));
  };

  return (
    <div
      ref={box}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the box takes the keyboard: arrows pan, + and - zoom.
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`${label}. Arrow keys pan, plus and minus zoom, 0 fits it to the box. The list view has every node.`}
      role="application"
      className="relative h-[min(68dvh,640px)] min-h-[340px] overflow-hidden bg-sunk outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]"
    >
      <svg
        ref={svg}
        className="block size-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        aria-hidden
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <Edges edges={edges} positions={positions} focus={focus} />
          <Nodes
            nodes={nodes}
            positions={positions}
            radius={radius}
            focus={focus}
            selected={selected}
            onNodeDown={onNodeDown}
            onHover={onHover}
          />
          <Labels nodes={nodes} positions={positions} radius={radius} focus={focus} selected={selected} k={view.k} />
        </g>
      </svg>
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button type="button" className="btn size-11 p-0 sm:size-9" onClick={zoomButton(1.3)} aria-label="Zoom in">
          <Plus size={16} aria-hidden />
        </button>
        <button type="button" className="btn size-11 p-0 sm:size-9" onClick={zoomButton(1 / 1.3)} aria-label="Zoom out">
          <Minus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="btn size-11 p-0 sm:size-9"
          onClick={onFit}
          aria-label="Fit the graph to the box"
        >
          <Maximize size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}

const Edges = memo(function Edges({
  edges,
  positions,
  focus,
}: {
  edges: GraphEdge[];
  positions: Map<string, Point>;
  focus: { id: string; lit: Set<string> } | null;
}) {
  return (
    <g>
      {edges.map((e) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        const on = focus ? e.source === focus.id || e.target === focus.id : false;
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            vectorEffect="non-scaling-stroke"
            strokeWidth={on ? 1.75 : 1}
            strokeDasharray={e.derived ? "4 3" : e.type === "about" ? "1.5 2.5" : undefined}
            style={{
              stroke: on ? "var(--accent)" : "var(--ink-3)",
              opacity: focus ? (on ? 0.9 : 0.08) : 0.32,
            }}
          />
        );
      })}
    </g>
  );
});

const Nodes = memo(function Nodes({
  nodes,
  positions,
  radius,
  focus,
  selected,
  onNodeDown,
  onHover,
}: {
  nodes: GraphNode[];
  positions: Map<string, Point>;
  radius: Map<string, number>;
  focus: { id: string; lit: Set<string> } | null;
  selected: string | null;
  onNodeDown: (e: ReactPointerEvent<SVGGElement>, id: string) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <g>
      {nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const r = radius.get(n.id) ?? 5;
        const dim = focus ? !focus.lit.has(n.id) : false;
        const candidate = n.status === "candidate";
        return (
          <g
            key={n.id}
            transform={`translate(${p.x} ${p.y})`}
            className="cursor-pointer"
            onPointerDown={(e) => onNodeDown(e, n.id)}
            onPointerEnter={(e) => e.pointerType === "mouse" && onHover(n.id)}
            onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
            style={{ opacity: dim ? 0.18 : 1, transition: "opacity 120ms ease" }}
          >
            {selected === n.id ? (
              <circle
                r={r + 4.5}
                vectorEffect="non-scaling-stroke"
                strokeWidth={2}
                fill="none"
                style={{ stroke: "var(--accent)" }}
              />
            ) : null}
            <circle
              r={r}
              vectorEffect="non-scaling-stroke"
              strokeWidth={candidate ? 2 : 1.5}
              strokeDasharray={candidate ? "2.5 2" : undefined}
              style={
                candidate
                  ? { fill: "var(--surface)", stroke: KIND_COLOR[n.kind] }
                  : { fill: KIND_COLOR[n.kind], stroke: "var(--surface)" }
              }
            />
            {n.kind === "product" || n.kind === "project" ? (
              <circle r={Math.max(1.5, r * 0.32)} style={{ fill: "var(--surface)" }} />
            ) : null}
          </g>
        );
      })}
    </g>
  );
});

const Labels = memo(function Labels({
  nodes,
  positions,
  radius,
  focus,
  selected,
  k,
}: {
  nodes: GraphNode[];
  positions: Map<string, Point>;
  radius: Map<string, number>;
  focus: { id: string; lit: Set<string> } | null;
  selected: string | null;
  k: number;
}) {
  const biggest = new Set(
    [...nodes]
      .sort((a, b) => (radius.get(b.id) ?? 0) - (radius.get(a.id) ?? 0))
      .slice(0, LABELS_AT_REST)
      .map((n) => n.id),
  );
  const shown = nodes.filter((n) =>
    focus ? focus.lit.has(n.id) : n.id === selected || k >= 1.8 || (biggest.has(n.id) && k >= 0.55),
  );
  const size = 11.5 / k;
  return (
    <g pointerEvents="none" style={{ fontSize: size, fontWeight: 500 }}>
      {shown.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const r = radius.get(n.id) ?? 5;
        const strong = focus?.id === n.id || n.id === selected;
        return (
          <text
            key={n.id}
            x={p.x + r + 4 / k}
            y={p.y + size * 0.35}
            paintOrder="stroke"
            strokeWidth={3.5 / k}
            strokeLinejoin="round"
            style={{
              fill: strong ? "var(--ink)" : "var(--ink-2)",
              stroke: "var(--sunk)",
              fontWeight: strong ? 600 : 500,
            }}
          >
            {n.label.length > 34 && !strong ? `${n.label.slice(0, 33).trimEnd()}…` : n.label}
          </text>
        );
      })}
    </g>
  );
});
