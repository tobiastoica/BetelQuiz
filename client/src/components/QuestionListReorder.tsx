import React, { useState, useRef, useEffect } from 'react';
import { GripVertical, Copy, Trash2 } from 'lucide-react';
import { KAHOOT_COLORS } from './ShapeIcon';
import type { Question } from '../types/quiz';

interface QuestionListReorderProps {
  questions: Question[];
  activeQuestionIndex: number;
  defaultTimeLimit?: number;
  defaultPoints?: number;
  onSelectQuestion: (index: number) => void;
  onReorderQuestions: (newQuestions: Question[], newActiveIndex: number) => void;
  onDuplicateQuestion: (index: number, e: React.MouseEvent) => void;
  onDeleteQuestion: (index: number, e: React.MouseEvent) => void;
}

export const QuestionListReorder: React.FC<QuestionListReorderProps> = ({
  questions,
  activeQuestionIndex,
  defaultTimeLimit = 20,
  defaultPoints = 1000,
  onSelectQuestion,
  onReorderQuestions,
  onDuplicateQuestion,
  onDeleteQuestion,
}) => {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [offsetY, setOffsetY] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const startYRef = useRef<number>(0);
  const initialRectsRef = useRef<{ top: number; height: number }[]>([]);
  const activePointerIdRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const hasMovedRef = useRef<boolean>(false);

  // Auto-scroll while dragging near top/bottom edges
  const scrollSpeedRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const startAutoScroll = () => {
    if (animFrameRef.current) return;
    const scrollLoop = () => {
      if (containerRef.current && scrollSpeedRef.current !== 0) {
        containerRef.current.scrollTop += scrollSpeedRef.current;
        animFrameRef.current = requestAnimationFrame(scrollLoop);
      } else {
        animFrameRef.current = null;
      }
    };
    animFrameRef.current = requestAnimationFrame(scrollLoop);
  };

  const stopAutoScroll = () => {
    scrollSpeedRef.current = 0;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, []);

  const handlePointerDown = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary button or touch
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}

    activePointerIdRef.current = e.pointerId;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    startYRef.current = e.clientY;

    // Snapshot positions of all items
    const rects = itemRefs.current.map((itemEl) => {
      if (!itemEl) return { top: 0, height: 75 };
      const r = itemEl.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    initialRectsRef.current = rects;

    setDraggedIdx(index);
    setTargetSlot(index);
    setOffsetY(0);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || draggedIdx === null) return;
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;

    const deltaY = e.clientY - startYRef.current;
    if (Math.abs(deltaY) > 4) {
      hasMovedRef.current = true;
    }

    setOffsetY(deltaY);

    const rects = initialRectsRef.current;
    if (!rects.length || !rects[draggedIdx]) return;

    // Visual center of dragged item
    const draggedCenter = rects[draggedIdx].top + rects[draggedIdx].height / 2 + deltaY;

    // Find slot whose center is closest to draggedCenter
    let closestSlot = draggedIdx;
    let minDistance = Infinity;

    rects.forEach((r, slotIdx) => {
      const slotCenter = r.top + r.height / 2;
      const dist = Math.abs(draggedCenter - slotCenter);
      if (dist < minDistance) {
        minDistance = dist;
        closestSlot = slotIdx;
      }
    });

    if (closestSlot !== targetSlot) {
      setTargetSlot(closestSlot);
    }

    // Auto-scroll when near boundaries of parent container
    if (containerRef.current) {
      const parentRect = containerRef.current.getBoundingClientRect();
      const topDist = e.clientY - parentRect.top;
      const bottomDist = parentRect.bottom - e.clientY;

      if (topDist < 50 && containerRef.current.scrollTop > 0) {
        scrollSpeedRef.current = -Math.max(2, Math.round((50 - topDist) / 4));
        startAutoScroll();
      } else if (bottomDist < 50) {
        scrollSpeedRef.current = Math.max(2, Math.round((50 - bottomDist) / 4));
        startAutoScroll();
      } else {
        stopAutoScroll();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || draggedIdx === null) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    stopAutoScroll();

    const fromIdx = draggedIdx;
    const toSlot = targetSlot !== null ? targetSlot : draggedIdx;

    if (hasMovedRef.current && toSlot !== fromIdx && toSlot >= 0 && toSlot < questions.length) {
      // Reorder array
      const newQuestions = [...questions];
      const [moved] = newQuestions.splice(fromIdx, 1);
      newQuestions.splice(toSlot, 0, moved);

      // Compute new active question index
      let newActiveIndex = activeQuestionIndex;
      if (activeQuestionIndex === fromIdx) {
        newActiveIndex = toSlot;
      } else if (fromIdx < toSlot) {
        if (activeQuestionIndex > fromIdx && activeQuestionIndex <= toSlot) {
          newActiveIndex = activeQuestionIndex - 1;
        }
      } else if (fromIdx > toSlot) {
        if (activeQuestionIndex >= toSlot && activeQuestionIndex < fromIdx) {
          newActiveIndex = activeQuestionIndex + 1;
        }
      }

      onReorderQuestions(newQuestions, newActiveIndex);
    } else if (!hasMovedRef.current) {
      // Simple tap / click -> select question
      onSelectQuestion(fromIdx);
    }

    isDraggingRef.current = false;
    hasMovedRef.current = false;
    activePointerIdRef.current = null;
    setDraggedIdx(null);
    setTargetSlot(null);
    setOffsetY(0);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    handlePointerUp(e);
  };

  return (
    <div
      ref={containerRef}
      className="space-y-3 flex-1 select-none touch-none"
    >
      {questions.map((q, idx) => {
        const isBeingDragged = draggedIdx === idx;
        const rects = initialRectsRef.current;

        // Calculate translation offset for real-time smooth animation
        let translateY = 0;
        let transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';

        if (isBeingDragged) {
          translateY = offsetY;
          transition = 'none'; // Instant 1:1 finger tracking
        } else if (draggedIdx !== null && targetSlot !== null && rects.length === questions.length) {
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

        // Live displayed slot number:
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

        const isActive = idx === activeQuestionIndex;
        const isCustom =
          (q.timeLimit !== undefined && Number(q.timeLimit) !== Number(defaultTimeLimit ?? 20)) ||
          (q.points !== undefined && Number(q.points) !== Number(defaultPoints ?? 1000));

        return (
          <div
            key={q.id}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            onPointerDown={(e) => handlePointerDown(idx, e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            style={{
              transform: `translateY(${translateY}px)`,
              transition,
              zIndex: isBeingDragged ? 40 : 1,
            }}
            className={`p-2.5 rounded-xl border cursor-grab active:cursor-grabbing transition-all relative group flex flex-col gap-1.5 touch-none ${
              isActive
                ? 'border-[#FAC747] bg-amber-400/10 shadow-lg ring-1 ring-[#FAC747]/40'
                : 'border-white/10 hover:border-white/20 bg-[#131938]/70'
            } ${
              isBeingDragged
                ? 'shadow-2xl ring-2 ring-[#FAC747] bg-[#182046] scale-[1.02] opacity-95'
                : 'shadow-xs'
            }`}
          >
            {/* Header: Grip Handle, Question Number & Type, Action Buttons */}
            <div className="flex items-center justify-between text-xs font-bold text-white/60 pointer-events-none">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="text-white/40 group-hover:text-white/80 transition-colors">
                  <GripVertical className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
                <span className={`truncate ${isActive ? 'text-[#FAC747]' : 'text-white/80'}`}>
                  {displaySlot + 1} {q.type.replace('_', ' ').toUpperCase()}
                </span>
                {isCustom && (
                  <span className="text-[9px] font-black text-[#FAC747] bg-amber-400/15 border border-amber-400/30 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                    Custom
                  </span>
                )}
              </div>

              {/* Action Buttons: Duplicate & Delete (pointerEvents auto to allow clicks) */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => onDuplicateQuestion(idx, e)}
                  title="Duplicate question"
                  className="p-1 hover:text-[#FAC747] hover:bg-white/10 rounded transition-colors cursor-pointer text-white/60"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => onDeleteQuestion(idx, e)}
                  title="Delete question"
                  className="p-1 hover:text-rose-400 hover:bg-rose-500/20 rounded transition-colors cursor-pointer text-white/60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Mini card visual preview */}
            <div className="h-16 bg-[#0F1433]/90 rounded-lg p-1.5 flex flex-col justify-between border border-white/10 overflow-hidden pointer-events-none">
              <div className="text-[10px] text-white/80 font-semibold line-clamp-1">
                {q.title || 'Question text...'}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(q.options || []).slice(0, 4).map((_, optIdx) => (
                  <div
                    key={optIdx}
                    className={`h-2 rounded-sm ${KAHOOT_COLORS[optIdx % KAHOOT_COLORS.length].bg}`}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
