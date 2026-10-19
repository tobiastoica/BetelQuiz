import React, { useEffect, useState, useMemo } from 'react';
import { Sparkles, HelpCircle } from 'lucide-react';
import type { TileLevel } from '../types/quiz';

interface PictureRevealGridProps {
  imageUrl?: string;
  tileLevel?: TileLevel;
  durationSeconds?: number;
  timeRemaining?: number;
  endsAt?: number;
  fullyRevealed?: boolean;
  className?: string;
}

export const PictureRevealGrid: React.FC<PictureRevealGridProps> = ({
  imageUrl,
  tileLevel = 'medium',
  durationSeconds = 20,
  timeRemaining,
  endsAt,
  fullyRevealed = false,
  className = '',
}) => {
  // Grid dimensions
  const { rows, cols } = useMemo(() => {
    switch (tileLevel) {
      case 'small':
        return { rows: 3, cols: 3 }; // 9 tiles
      case 'big':
        return { rows: 6, cols: 6 }; // 36 tiles
      case 'medium':
      default:
        return { rows: 4, cols: 4 }; // 16 tiles
    }
  }, [tileLevel]);

  const totalTiles = rows * cols;

  // Compute a stable pseudo-random dissolution sequence
  const dissolveOrder = useMemo(() => {
    const indices = Array.from({ length: totalTiles }, (_, i) => i);
    // Fisher-Yates shuffle with fixed seed-like pseudo randomness based on totalTiles
    for (let i = indices.length - 1; i > 0; i--) {
      const j = (i * 7 + 11) % (i + 1);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  }, [totalTiles]);

  // Local progress tracker if timeRemaining is not provided
  const [localProgress, setLocalProgress] = useState(0);

  useEffect(() => {
    if (fullyRevealed) {
      setLocalProgress(1);
      return;
    }

    if (endsAt && durationSeconds > 0) {
      const updateFromEndsAt = () => {
        const remainingMs = Math.max(0, endsAt - Date.now());
        const totalMs = durationSeconds * 1000;
        const elapsed = Math.max(0, totalMs - remainingMs);
        setLocalProgress(Math.min(1, elapsed / totalMs));
      };
      updateFromEndsAt();
      const interval = setInterval(updateFromEndsAt, 200);
      return () => clearInterval(interval);
    }

    if (timeRemaining !== undefined && durationSeconds > 0) {
      const elapsed = Math.max(0, durationSeconds - timeRemaining);
      setLocalProgress(Math.min(1, elapsed / durationSeconds));
      return;
    }

    // Auto-progress based on duration
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const progress = Math.min(1, elapsed / durationSeconds);
      setLocalProgress(progress);
      if (progress >= 1) clearInterval(interval);
    }, 200);

    return () => clearInterval(interval);
  }, [durationSeconds, timeRemaining, endsAt, fullyRevealed]);

  // Number of tiles that should be removed based on progress
  const tilesToRemoveCount = fullyRevealed
    ? totalTiles
    : Math.floor(localProgress * totalTiles);

  const dissolvedTileSet = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < tilesToRemoveCount; i++) {
      set.add(dissolveOrder[i]);
    }
    return set;
  }, [tilesToRemoveCount, dissolveOrder]);

  if (!imageUrl) {
    return (
      <div className={`flex items-center justify-center bg-slate-800/80 rounded-3xl border border-white/10 aspect-video max-w-xl mx-auto text-slate-400 p-8 ${className}`}>
        <HelpCircle className="w-16 h-16 opacity-40 animate-pulse" />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-3xl shadow-2xl border-4 border-white/20 bg-slate-950 aspect-video max-w-3xl w-full mx-auto select-none ${className}`}
    >
      {/* Background Mystery Image */}
      <img
        src={imageUrl}
        alt="Mystery Reveal"
        className="absolute inset-0 w-full h-full object-contain bg-slate-900 transition-all duration-700"
      />

      {/* Progressive Grid Overlay */}
      <div
        className="absolute inset-0 grid gap-[2px] p-[2px] bg-slate-950/40 backdrop-blur-[1px]"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: totalTiles }, (_, idx) => {
          const isDissolved = dissolvedTileSet.has(idx);

          return (
            <div
              key={idx}
              className={`relative flex items-center justify-center transition-all duration-700 ease-out ${
                isDissolved
                  ? 'opacity-0 scale-90 pointer-events-none'
                  : 'opacity-100 scale-100 bg-gradient-to-br from-[#1E2756] via-[#131938] to-[#0B0F24] border border-[#FAC747]/20 shadow-md'
              }`}
            >
              {!isDissolved && (
                <div className="flex flex-col items-center justify-center text-[#FAC747]/40 pointer-events-none">
                  {tileLevel === 'small' ? (
                    <Sparkles className="w-8 h-8 opacity-60 text-[#FAC747]" />
                  ) : tileLevel === 'medium' ? (
                    <HelpCircle className="w-5 h-5 opacity-50 text-[#FAC747]" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-[#FAC747]/40" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating reveal badge on active question */}
      {!fullyRevealed && (
        <div className="absolute bottom-3 right-3 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full border border-white/10 text-[11px] font-bold text-white/80 shadow">
          Revealing... {Math.round((tilesToRemoveCount / totalTiles) * 100)}%
        </div>
      )}
    </div>
  );
};
