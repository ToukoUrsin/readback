import dagre from '@dagrejs/dagre';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramBlock } from '../../../shared/tour';

const NODE_W = 176;
const lines = (s: string | undefined, perLine: number) => (s ? Math.max(1, Math.ceil(s.length / perLine)) : 0);
const nodeH = (n: DiagramBlock['nodes'][number]) => 22 + lines(n.label, 21) * 18 + lines(n.sub, 26) * 16;

function layout(d: DiagramBlock, dir: 'LR' | 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: dir === 'LR' ? 18 : 28, ranksep: dir === 'LR' ? 56 : 38, marginx: 2, marginy: 2 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of d.nodes) g.setNode(n.id, { width: NODE_W, height: nodeH(n) });
  for (const e of d.edges) if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to, e.label ? { label: e.label, width: e.label.length * 6.4 + 14, height: 18, labelpos: 'c' } : {});
  dagre.layout(g);
  const gg = g.graph();
  return {
    w: gg.width ?? 0,
    h: gg.height ?? 0,
    nodes: d.nodes.map((n) => ({ ...n, ...(g.node(n.id) as { x: number; y: number; width: number; height: number }) })),
    edges: g.edges().map((e) => {
      const v = g.edge(e) as { points: { x: number; y: number }[]; label?: string; x?: number; y?: number };
      return { key: `${e.v}>${e.w}`, points: v.points, label: v.label, x: v.x, y: v.y };
    }),
  };
}

function path(p: { x: number; y: number }[]) {
  if (p.length < 3) return `M${p.map((q) => `${q.x},${q.y}`).join('L')}`;
  let d = `M${p[0]!.x},${p[0]!.y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const end = i === p.length - 2 ? p[i + 1]! : { x: (p[i]!.x + p[i + 1]!.x) / 2, y: (p[i]!.y + p[i + 1]!.y) / 2 };
    d += `Q${p[i]!.x},${p[i]!.y} ${end.x},${end.y}`;
  }
  return d;
}

const ROLE: Record<DiagramBlock['nodes'][number]['role'], { box: string; dot: string; name: string }> = {
  new: { box: 'border-ok/45 bg-ok-soft', dot: 'bg-ok', name: 'New in this change' },
  changed: { box: 'border-warn/40 bg-warn/[0.07]', dot: 'bg-warn', name: 'Changed' },
  existing: { box: 'border-line-strong bg-raised', dot: 'bg-fg4', name: 'Already there' },
  outside: { box: 'border-dashed border-line-strong bg-transparent', dot: 'border border-fg4', name: 'Outside the code' },
};

export function Diagram({ d }: { d: DiagramBlock }) {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth - 40));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => {
    const lr = layout(d, 'LR');
    return lr.w <= room ? lr : layout(d, 'TB');
  }, [d, room]);
  const roles = [...new Set(d.nodes.map((n) => n.role))];
  const id = `arrow-${d.title.replace(/\W+/g, '')}`;

  return (
    <figure ref={ref} className="card my-5 overflow-hidden">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-[510] text-fg3">{d.title}</span>
        <span className="hidden items-center gap-3 sm:flex">
          {roles.map((r) => (
            <span key={r} className="flex items-center gap-1.5 text-[11px] text-fg4">
              <i className={`size-2 rounded-full ${ROLE[r].dot}`} />
              {ROLE[r].name}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="overflow-x-auto px-5 py-6">
        <div className="relative mx-auto" style={{ width: g.w, height: g.h }}>
          <svg width={g.w} height={g.h} className="absolute inset-0" aria-hidden>
            <defs>
              <marker id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M1 1.2 7 4 1 6.8" fill="none" stroke="var(--fg4)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {g.edges.map((e) => (
              <path key={e.key} d={path(e.points)} fill="none" stroke="var(--fg4)" strokeWidth="1.2" markerEnd={`url(#${id})`} />
            ))}
          </svg>
          {g.edges.map((e) =>
            e.label && e.x !== undefined && e.y !== undefined ? (
              <span key={e.key} className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-panel px-1.5 text-[11px] leading-[18px] whitespace-nowrap text-fg3" style={{ left: e.x, top: e.y }}>
                {e.label}
              </span>
            ) : null,
          )}
          {g.nodes.map((n) => (
            <div key={n.id} className={`absolute flex flex-col justify-center rounded-lg border px-3 ${ROLE[n.role].box}`} style={{ left: n.x - n.width / 2, top: n.y - n.height / 2, width: n.width, height: n.height }}>
              <span className="font-mono text-[12px] leading-[18px] font-[510] break-words text-fg">{n.label}</span>
              {n.sub && <span className="text-[11.5px] leading-4 text-fg3">{n.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
