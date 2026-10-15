import React, { useState, useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { KAHOOT_COLORS, ShapeIcon } from './ShapeIcon';

interface PuzzleOption {
  id: string;
  text: string;
}

interface PuzzleReorderProps {
  options: PuzzleOption[];
  order: string[];
  onChangeOrder: (newOrder: string[]) => void;
}

export const PuzzleReorder: React.FC<PuzzleReorderProps> = ({
  options,
  order,
  onChangeOrder,
}) => {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [slotPositions, setSlotPositions] = useState<{ top: number; height: number }[]>([]);

  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const startYRef = useRef<number>(0);
  const targetSlotRef = useRef<number | null>(null);
  const draggedIdxRef = useRef<number | null>(null);
  const initialRectsRef = useRef<{ top: number; height: number }[]>([]);
  const activePointerIdRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  // Clean Pointer Down: Starts dragging immediately with 0 delay on touch or click
  const handlePointerDown = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary button or touch
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}

    activePointerIdRef.current = e.pointerId;
    isDraggingRef.current = true;
    draggedIdxRef.current = index;
    startYRef.current = e.clientY;
    targetSlotRef.current = index;

    // Snapshot positions of all items
    const rects = itemRefs.current.map((itemEl) => {
      if (!itemEl) return { top: 0, height: 60 };
      const r = itemEl.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    initialRectsRef.current = rects;

    setSlotPositions(rects);
    setDraggedIdx(index);
    setTargetSlot(index);
  };

  // Pointer Move: Follow finger/mouse smoothly in real time without triggering 120Hz full re-renders
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const activeIdx = draggedIdxRef.current;
    if (!isDraggingRef.current || activeIdx === null) return;
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;

    e.preventDefault();
    const deltaY = e.clientY - startYRef.current;

    // Direct DOM transform update for dragged item eliminates React re-render stutter
    const draggedEl = itemRefs.current[activeIdx];
    if (draggedEl) {
      draggedEl.style.transform = `translateY(${deltaY}px)`;
      draggedEl.style.transition = 'none';
    }

    const rects = initialRectsRef.current;
    if (!rects.length || !rects[activeIdx]) return;

    // Visual center of dragged item
    const draggedCenter = rects[activeIdx].top + rects[activeIdx].height / 2 + deltaY;

    // Find slot whose center is closest to draggedCenter
    let closestSlot = activeIdx;
    let minDistance = Infinity;

    rects.forEach((r, slotIdx) => {
      const slotCenter = r.top + r.height / 2;
      const dist = Math.abs(draggedCenter - slotCenter);
      if (dist < minDistance) {
        minDistance = dist;
        closestSlot = slotIdx;
      }
    });

    if (closestSlot !== targetSlotRef.current) {
      targetSlotRef.current = closestSlot;
      setTargetSlot(closestSlot);
    }
  };

  // Pointer Up: Commit new order cleanly
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const activeIdx = draggedIdxRef.current !== null ? draggedIdxRef.current : draggedIdx;
    if (!isDraggingRef.current || activeIdx === null) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const fromIdx = activeIdx;
    const toSlot = targetSlotRef.current !== null ? targetSlotRef.current : (targetSlot !== null ? targetSlot : fromIdx);

    const draggedEl = itemRefs.current[activeIdx];
    if (draggedEl) {
      draggedEl.style.transform = '';
      draggedEl.style.transition = '';
    }

    if (toSlot !== fromIdx && toSlot >= 0 && toSlot < order.length) {
      const newOrder = [...order];
      const [movedItem] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toSlot, 0, movedItem);
      onChangeOrder(newOrder);
    }

    isDraggingRef.current = false;
    draggedIdxRef.current = null;
    activePointerIdRef.current = null;
    targetSlotRef.current = null;
    setDraggedIdx(null);
    setTargetSlot(null);
    setSlotPositions([]);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    handlePointerUp(e);
  };

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col justify-around gap-2 select-none touch-none">
      {order.map((optId, idx) => {
        const opt = options.find((o) => o.id === optId);
        const originalIndex = options.findIndex((o) => o.id === optId);
        const itemIndex = originalIndex >= 0 ? originalIndex : idx;
        const color = KAHOOT_COLORS[itemIndex % KAHOOT_COLORS.length];

        const isBeingDragged = draggedIdx === idx;
        const rects = slotPositions;

        // Calculate translation offset for real-time smooth animation of other items
        let translateY = 0;
        let transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';

        if (!isBeingDragged && draggedIdx !== null && targetSlot !== null && rects.length === order.length) {
          // If another item is being dragged past this item, shift this item out of the way
          if (draggedIdx < targetSlot) {
            // Dragging downwards: items between draggedIdx + 1 and targetSlot shift UP
            if (idx > draggedIdx && idx <= targetSlot) {
              const shift = rects[idx - 1].top - rects[idx].top;
              translateY = shift;
            }
          } else if (draggedIdx > targetSlot) {
            // Dragging upwards: items between targetSlot and draggedIdx - 1 shift DOWN
            if (idx >= targetSlot && idx < draggedIdx) {
              const shift = rects[idx + 1].top - rects[idx].top;
              translateY = shift;
            }
          }
        }

        // Live displayed slot index:
        let displaySlot = idx;
        if (isBeingDragged && targetSlot !== null) {
          displaySlot = targetSlot;
        } else if (draggedIdx !== null && targetSlot !== null) {
          if (draggedIdx < targetSlot && idx > draggedIdx && idx <= targetSlot) {
            displaySlot = idx - 1;
          } else if (draggedIdx > targetSlot && idx >= targetSlot && idx < draggedIdx) {
            displaySlot = idx + 1;
          }
        }

        return (
          <div
            key={optId}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            onPointerDown={(e) => handlePointerDown(idx, e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            style={{
              transform: !isBeingDragged && translateY ? `translateY(${translateY}px)` : undefined,
              transition: !isBeingDragged ? transition : 'none',
              zIndex: isBeingDragged ? 50 : 1,
            }}
            className={`flex items-center justify-between gap-2.5 sm:gap-3.5 px-3 sm:px-4 py-2 sm:py-3 rounded-xl sm:rounded-2xl border-2 border-white/20 select-none touch-none cursor-grab active:cursor-grabbing ${
              color.bg
            } text-white ${
              isBeingDragged
                ? 'shadow-2xl ring-4 ring-white/90 scale-[1.02]'
                : 'shadow-md'
            }`}
          >
            {/* Slot Number Badge & Shape & Text */}
            <div className="flex items-center gap-2 sm:gap-3.5 flex-1 min-w-0 pointer-events-none">
              <span className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-black/30 backdrop-blur text-white font-black text-xs sm:text-sm flex items-center justify-center shrink-0 border border-white/30 shadow-inner">
                {displaySlot + 1}
              </span>
              <ShapeIcon
                index={itemIndex}
                size={22}
                className="shrink-0 drop-shadow text-white"
              />
              <span className="text-white font-extrabold text-xs sm:text-base md:text-lg line-clamp-1 drop-shadow">
                {opt?.text || 'Item'}
              </span>
            </div>

            {/* Draggable Grip Handle */}
            <div className="p-1 sm:p-1.5 text-white/90 rounded-lg shrink-0 pointer-events-none">
              <GripVertical className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
            </div>
          </div>
        );
      })}
    </div>
  );
};
