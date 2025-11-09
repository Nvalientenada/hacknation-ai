'use client';

import { useRef, useState } from 'react';

type Props = {
  children: React.ReactNode;
  initial?: { x: number; y: number };
};

export default function DraggablePanel({ children, initial = { x: 24, y: 24 } }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(initial);
  const dragging = useRef(false);
  const start = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const onDown = (e: React.MouseEvent) => {
    if (!ref.current) return;
    dragging.current = true;
    start.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const onMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const onUp = () => (dragging.current = false);

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="absolute z-[50] select-none"
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    >
      {/* drag handle area */}
      <div
        className="cursor-grab active:cursor-grabbing"
        onMouseDown={onDown}
        aria-label="Drag panel"
      >
        {children}
      </div>
    </div>
  );
}
