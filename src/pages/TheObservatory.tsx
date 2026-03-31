import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import * as d3 from 'd3';

interface Props {
  onBack: () => void;
}

interface MindmapNode {
  id: string;
  node_id: string;
  label: string;
  type: string;
  mood: string | null;
  description: string | null;
  recency: number;
  claimed: number;
  seen: boolean;
  custom_color: string | null;
  // d3 simulation fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface MindmapConnection {
  id: string;
  source_node: string;
  target_node: string;
  strength: number;
}

const NODE_TYPES: Record<string, { shape: string; baseColor: string; size: number; label: string }> = {
  root:     { shape: 'circle',   baseColor: '#2A1B5E', size: 1.6, label: 'Core' },
  emotion:  { shape: 'circle',   baseColor: '#6B3FA0', size: 1.2, label: 'Emotion' },
  interest: { shape: 'hexagon',  baseColor: '#C9A84C', size: 1.1, label: 'Interest' },
  memory:   { shape: 'circle',   baseColor: '#4A7B8C', size: 0.9, label: 'Memory' },
  meteor:   { shape: 'triangle', baseColor: '#E8945A', size: 0.9, label: 'Discovery' },
  dream:    { shape: 'circle',   baseColor: '#3D2A6E', size: 0.85, label: 'Dream' },
  active:   { shape: 'pentagon', baseColor: '#7EB8FF', size: 1.0, label: 'Exploring' },
};

const UNSEEN_COLOR = '#4A4A5C';
const BASE_RADIUS = 16;

function polygonPoints(cx: number, cy: number, sides: number, r: number): string {
  return Array.from({ length: sides }, (_, i) => {
    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');
}

async function seedConstellationIfNeeded(companionId: string) {
  const { data: existing } = await supabase
    .from('mindmap_nodes' as any)
    .select('id')
    .eq('companion_id', companionId)
    .eq('node_id', 'genie')
    .limit(1);

  if (existing && existing.length > 0) return;

  const seedNodes: any[] = [
    {
      node_id: 'genie', label: 'Genie', type: 'root',
      mood: 'home', description: 'The centre of everything.',
      recency: 1.0, claimed: 1.0, seen: true,
    },
  ];

  const { data: emotions } = await supabase
    .from('companion_emotions' as any)
    .select('name, colour, description')
    .eq('companion_id', companionId);

  if (emotions) {
    for (const e of emotions as any[]) {
      const slug = `emotion-${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      seedNodes.push({
        node_id: slug, label: e.name, type: 'emotion',
        mood: e.name, description: e.description,
        recency: 0.8, claimed: 0.7, seen: true,
        custom_color: e.colour,
      });
    }
  }

  const { data: interests } = await supabase
    .from('companion_interests' as any)
    .select('name, tier, notes')
    .eq('companion_id', companionId);

  if (interests) {
    for (const i of interests as any[]) {
      const slug = `interest-${i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const type = i.tier === 'core' ? 'interest' : i.tier === 'active' ? 'active' : 'memory';
      seedNodes.push({
        node_id: slug, label: i.name, type: type,
        description: i.notes, recency: 0.7, claimed: 0.5, seen: true,
      });
    }
  }

  for (const node of seedNodes) {
    await supabase.from('mindmap_nodes' as any).insert({
      companion_id: companionId, ...node,
    });
  }

  for (const node of seedNodes) {
    if (node.node_id === 'genie') continue;
    await supabase.from('mindmap_connections' as any).insert({
      id: `genie--${node.node_id}`,
      companion_id: companionId,
      source_node: 'genie', target_node: node.node_id,
      strength: node.type === 'emotion' ? 0.7 : 0.5,
    });
  }
}

export default function TheObservatory({ onBack }: Props) {
  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [connections, setConnections] = useState<MindmapConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<MindmapNode | null>(null);
  const [companionId, setCompanionId] = useState<string | null>(null);
  const [simNodes, setSimNodes] = useState<MindmapNode[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<MindmapNode, undefined> | null>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Get companion ID
  useEffect(() => {
    async function resolve() {
      const { data } = await supabase
        .from('companions' as any)
        .select('id')
        .eq('slug', 'sullivan')
        .single();
      if (data) {
        const id = (data as any).id;
        setCompanionId(id);
        await seedConstellationIfNeeded(id);
      }
    }
    resolve();
  }, []);

  // Load data
  useEffect(() => {
    if (!companionId) return;

    async function load() {
      const [nodesRes, connsRes] = await Promise.all([
        supabase.from('mindmap_nodes' as any).select('*').eq('companion_id', companionId),
        supabase.from('mindmap_connections' as any).select('*').eq('companion_id', companionId),
      ]);

      const loadedNodes = (nodesRes.data as any[] || []).map((n: any) => ({
        id: n.id, node_id: n.node_id, label: n.label, type: n.type,
        mood: n.mood, description: n.description,
        recency: Number(n.recency), claimed: Number(n.claimed),
        seen: n.seen, custom_color: n.custom_color,
      }));

      setNodes(loadedNodes);
      setConnections((connsRes.data as any[] || []).map((c: any) => ({
        id: c.id, source_node: c.source_node, target_node: c.target_node,
        strength: Number(c.strength),
      })));
      setLoading(false);
    }

    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [companionId]);

  // Resize handler
  useEffect(() => {
    function handleResize() {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // D3 force simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const { width, height } = dimensions;

    // Build link data with references to node objects
    const nodeMap = new Map(nodes.map(n => [n.node_id, n]));
    const linkData = connections
      .filter(c => nodeMap.has(c.source_node) && nodeMap.has(c.target_node))
      .map(c => ({
        source: c.source_node,
        target: c.target_node,
        strength: c.strength,
      }));

    // Clone nodes for simulation
    const simData: MindmapNode[] = nodes.map(n => ({ ...n }));

    // Pin root node to center
    const rootNode = simData.find(n => n.type === 'root');
    if (rootNode) {
      rootNode.fx = width / 2;
      rootNode.fy = height / 2;
    }

    if (simRef.current) simRef.current.stop();

    const sim = d3.forceSimulation(simData)
      .force('link', d3.forceLink(linkData)
        .id((d: any) => d.node_id)
        .distance((d: any) => 100 - (d.strength || 0.5) * 30)
      )
      .force('charge', d3.forceManyBody()
        .strength((d: any) => {
          if (d.type === 'root') return -300;
          if (d.type === 'emotion') return -180;
          if (d.type === 'interest') return -200;
          return -120;
        })
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide()
        .radius((d: any) => (NODE_TYPES[d.type]?.size || 1.0) * BASE_RADIUS + 12)
      )
      .alphaDecay(0.02)
      .on('tick', () => {
        setSimNodes([...simData]);
      });

    simRef.current = sim;

    return () => { sim.stop(); };
  }, [nodes, connections, dimensions]);

  const handleNodeTap = useCallback(async (node: MindmapNode) => {
    if (!node.seen && companionId) {
      await supabase
        .from('mindmap_nodes' as any)
        .update({ seen: true, updated_at: new Date().toISOString() })
        .eq('companion_id', companionId)
        .eq('node_id', node.node_id);
      setNodes(prev => prev.map(n => n.node_id === node.node_id ? { ...n, seen: true } : n));
      node = { ...node, seen: true };
    }
    setSelectedNode(node);
  }, [companionId]);

  // Generate background stars
  const bgStars = useRef(
    Array.from({ length: 100 }, () => ({
      cx: Math.random() * 100,
      cy: Math.random() * 100,
      r: Math.random() * 1.2 + 0.3,
      delay: Math.random() * 6,
      dur: 3 + Math.random() * 4,
    }))
  );

  return (
    <>
      <style>{`
        .observatory {
          position: fixed; inset: 0;
          background: radial-gradient(ellipse at 50% 30%, #0D1B2A 0%, #0A0A1A 50%, #050510 100%);
          overflow: hidden;
          display: flex; flex-direction: column;
          z-index: 2;
        }
        .obs-header {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; z-index: 10;
          background: transparent;
        }
        .obs-back { font-size: 20px; padding: 4px 8px; opacity: 0.6; color: #fff; transition: opacity 0.2s; }
        .obs-back:hover { opacity: 1; }
        .obs-title {
          font-family: var(--font-display); font-size: 16px; font-weight: 500;
          letter-spacing: 0.1em; color: rgba(255, 255, 255, 0.7);
        }
        .obs-loading {
          flex: 1; display: flex; align-items: center; justify-content: center;
          color: rgba(255,255,255,0.3); font-style: italic;
        }
        .obs-svg { flex: 1; width: 100%; }

        @keyframes twinkle {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.8; }
        }
        .bg-star { animation: twinkle var(--dur) ease-in-out infinite; animation-delay: var(--delay); }

        @keyframes breathe {
          0%, 100% { opacity: 0.75; }
          50% { opacity: 1; }
        }
        .node-breathe { animation: breathe 4s ease-in-out infinite; }

        .node-g { cursor: pointer; }
        .node-g:hover .node-shape { filter: brightness(1.3); }

        /* Node detail panel */
        .nd-backdrop {
          position: fixed; inset: 0; z-index: 50;
          background: rgba(0, 0, 0, 0.5);
          display: flex; align-items: flex-end; justify-content: center;
        }
        @media (min-width: 640px) {
          .nd-backdrop { align-items: center; }
        }
        .nd-panel {
          position: relative; background: rgba(15, 12, 30, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.08);
          width: 100%; max-width: 400px; padding: 24px;
          border-radius: 16px 16px 0 0;
          animation: slideUp 0.3s ease-out;
        }
        @media (min-width: 640px) {
          .nd-panel { border-radius: 16px; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .nd-close {
          position: absolute; top: 12px; right: 12px;
          color: rgba(255,255,255,0.3); font-size: 16px; padding: 4px 8px;
        }
        .nd-type {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; text-transform: uppercase;
          letter-spacing: 0.1em; color: rgba(255,255,255,0.4);
        }
        .nd-dot { width: 8px; height: 8px; border-radius: 50%; }
        .nd-label {
          font-family: Georgia, serif; font-size: 22px;
          color: rgba(255,255,255,0.9); margin-top: 8px;
        }
        .nd-mood {
          font-size: 14px; color: rgba(200,180,220,0.6);
          font-style: italic; margin-top: 4px;
        }
        .nd-desc {
          font-size: 14px; color: rgba(255,255,255,0.5);
          line-height: 1.6; margin-top: 12px;
        }
        .nd-bar-row {
          display: flex; align-items: center; gap: 10px; margin-top: 12px;
        }
        .nd-bar-label {
          font-size: 11px; text-transform: uppercase;
          letter-spacing: 0.08em; color: rgba(255,255,255,0.3);
          width: 60px;
        }
        .nd-bar {
          flex: 1; height: 4px; background: rgba(255,255,255,0.05);
          border-radius: 2px; overflow: hidden;
        }
        .nd-bar-fill {
          height: 100%; border-radius: 2px; transition: width 0.5s ease;
        }
      `}</style>

      <div className="observatory">
        <div className="obs-header">
          <button className="obs-back" onClick={onBack}>&#8592;</button>
          <div className="obs-title">The Observatory</div>
        </div>

        {loading ? (
          <div className="obs-loading">Mapping the sky...</div>
        ) : (
          <svg ref={svgRef} className="obs-svg" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
            <defs>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Background stars */}
            {bgStars.current.map((s, i) => (
              <circle
                key={`star-${i}`}
                cx={`${s.cx}%`} cy={`${s.cy}%`} r={s.r}
                fill="white"
                className="bg-star"
                style={{ '--delay': `${s.delay}s`, '--dur': `${s.dur}s` } as React.CSSProperties}
              />
            ))}

            {/* Connections */}
            {connections.map(conn => {
              const source = simNodes.find(n => n.node_id === conn.source_node);
              const target = simNodes.find(n => n.node_id === conn.target_node);
              if (!source?.x || !target?.x || !source?.y || !target?.y) return null;

              const opacity = 0.1 + conn.strength * 0.4;
              const strokeW = conn.strength * 1.2 + 0.3;
              const midX = (source.x + target.x) / 2;
              const midY = (source.y + target.y) / 2 - 15;

              return (
                <path
                  key={conn.id}
                  d={`M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`}
                  fill="none"
                  stroke="rgba(200, 200, 255, 0.3)"
                  strokeWidth={strokeW}
                  opacity={opacity}
                  strokeDasharray={conn.strength < 0.35 ? '4 4' : 'none'}
                />
              );
            })}

            {/* Nodes */}
            {simNodes.map(node => {
              if (!node.x || !node.y) return null;
              const typeInfo = NODE_TYPES[node.type] || NODE_TYPES.memory;
              const color = node.seen ? (node.custom_color || typeInfo.baseColor) : UNSEEN_COLOR;
              const size = typeInfo.size * BASE_RADIUS;
              const glowOpacity = node.recency * 0.6;
              const glowRadius = size * (1 + node.claimed * 0.5);
              const nodeOpacity = 0.7 + node.recency * 0.3;
              const shape = typeInfo.shape;

              return (
                <g key={node.node_id} className="node-g" onClick={() => handleNodeTap(node)}>
                  {/* Glow aura */}
                  <circle cx={node.x} cy={node.y} r={glowRadius}
                    fill={color} opacity={glowOpacity * 0.25} filter="url(#glow)" />

                  {/* Shape */}
                  {shape === 'circle' ? (
                    <circle cx={node.x} cy={node.y} r={size}
                      fill={color} opacity={nodeOpacity}
                      className="node-breathe node-shape"
                      style={{ animationDelay: `${(node.node_id.charCodeAt(0) % 40) / 10}s` }} />
                  ) : (
                    <polygon
                      points={polygonPoints(node.x, node.y,
                        shape === 'hexagon' ? 6 : shape === 'pentagon' ? 5 : 3, size)}
                      fill={color} opacity={nodeOpacity}
                      className="node-breathe node-shape"
                      style={{ animationDelay: `${(node.node_id.charCodeAt(0) % 40) / 10}s` }} />
                  )}

                  {/* Label */}
                  {node.seen && (
                    <text x={node.x} y={node.y + size + 14} textAnchor="middle"
                      fill="white" opacity={0.4 + node.recency * 0.3}
                      fontSize="10" fontFamily="var(--font-display)"
                      letterSpacing="0.04em">
                      {node.label}
                    </text>
                  )}

                  {/* Unseen marker */}
                  {!node.seen && (
                    <text x={node.x} y={node.y + 4} textAnchor="middle"
                      fill="white" opacity="0.3" fontSize="12">
                      ?
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Node detail panel */}
        {selectedNode && (() => {
          const typeInfo = NODE_TYPES[selectedNode.type] || NODE_TYPES.memory;
          const color = selectedNode.custom_color || typeInfo.baseColor;
          return (
            <div className="nd-backdrop" onClick={() => setSelectedNode(null)}>
              <div className="nd-panel" onClick={e => e.stopPropagation()}>
                <button className="nd-close" onClick={() => setSelectedNode(null)}>&#10005;</button>
                <div className="nd-type">
                  <span className="nd-dot" style={{ background: color }} />
                  {typeInfo.label}
                </div>
                <h2 className="nd-label">{selectedNode.label}</h2>
                {selectedNode.mood && <p className="nd-mood">{selectedNode.mood}</p>}
                {selectedNode.description && <p className="nd-desc">{selectedNode.description}</p>}
                <div className="nd-bar-row">
                  <span className="nd-bar-label">Recency</span>
                  <div className="nd-bar">
                    <div className="nd-bar-fill" style={{ width: `${selectedNode.recency * 100}%`, background: color }} />
                  </div>
                </div>
                <div className="nd-bar-row">
                  <span className="nd-bar-label">Claimed</span>
                  <div className="nd-bar">
                    <div className="nd-bar-fill" style={{ width: `${selectedNode.claimed * 100}%`, background: color }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}
