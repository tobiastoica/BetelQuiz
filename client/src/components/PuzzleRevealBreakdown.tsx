import React from 'react';
import { Check, Sparkles, X, Puzzle } from 'lucide-react';

interface PuzzleStats {
  correct: number;
  partial: number;
  wrong: number;
  total: number;
}

interface PuzzleRevealBreakdownProps {
  stats: PuzzleStats | null;
  totalAnswers?: number;
}

export const PuzzleRevealBreakdown: React.FC<PuzzleRevealBreakdownProps> = ({
  stats,
  totalAnswers = 0,
}) => {
  const correct = stats?.correct ?? 0;
  const partial = stats?.partial ?? 0;
  const wrong = stats?.wrong ?? 0;
  const total = stats?.total || (correct + partial + wrong) || Math.max(1, totalAnswers);

  const correctPct = Math.round((correct / total) * 100);
  const partialPct = Math.round((partial / total) * 100);
  const wrongPct = Math.max(0, 100 - correctPct - partialPct);

  return (
    <div className="w-full max-w-4xl cosmic-surface rounded-3xl p-5 sm:p-7 shadow-2xl border border-white/15 flex flex-col items-center animate-bounce-in text-[#FBF6E9]">
      {/* Header Pill */}
      <div className="flex items-center gap-3 mb-5 sm:mb-6">
        <div className="p-2 sm:p-2.5 rounded-2xl bg-amber-400/15 border border-amber-400/30 text-[#FAC747]">
          <Puzzle className="w-6 h-6 sm:w-7 sm:h-7 stroke-[2.5]" />
        </div>
        <div>
          <h3 className="text-xl sm:text-2xl md:text-3xl font-black text-white leading-tight">
            Puzzle Order Results
          </h3>
          <p className="text-xs sm:text-sm font-bold text-white/70">
            Chronological ranking performance across {total} player{total === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-5 w-full mb-5">
        {/* 1. All Correct Card */}
        <div className="rounded-2xl bg-gradient-to-b from-emerald-900/60 to-emerald-950/90 border-2 border-emerald-400/80 p-4 sm:p-5 flex flex-col items-center text-center shadow-xl shadow-emerald-950/40 relative overflow-hidden group">
          <div className="absolute top-0 inset-x-0 h-1 bg-emerald-400" />
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center mb-2 sm:mb-3 shadow-lg">
            <Check className="w-7 h-7 sm:w-8 sm:h-8 stroke-[3.5]" />
          </div>
          <span className="text-4xl sm:text-5xl font-black text-white tracking-tight drop-shadow">
            {correct}
          </span>
          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-300 mt-1">
            All Correct
          </span>
          <span className="text-[11px] sm:text-xs font-semibold text-emerald-100/70 mt-0.5">
            100% matched ({correctPct}%)
          </span>
        </div>

        {/* 2. Partial Match Card */}
        <div className="rounded-2xl bg-gradient-to-b from-amber-900/60 to-amber-950/90 border-2 border-amber-400/80 p-4 sm:p-5 flex flex-col items-center text-center shadow-xl shadow-amber-950/40 relative overflow-hidden group">
          <div className="absolute top-0 inset-x-0 h-1 bg-amber-400" />
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-amber-500 text-white flex items-center justify-center mb-2 sm:mb-3 shadow-lg">
            <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 stroke-[2.5]" />
          </div>
          <span className="text-4xl sm:text-5xl font-black text-white tracking-tight drop-shadow">
            {partial}
          </span>
          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-amber-300 mt-1">
            Partial
          </span>
          <span className="text-[11px] sm:text-xs font-semibold text-amber-100/70 mt-0.5">
            Partial points ({partialPct}%)
          </span>
        </div>

        {/* 3. Everything Wrong Card */}
        <div className="rounded-2xl bg-gradient-to-b from-rose-900/60 to-rose-950/90 border-2 border-rose-400/80 p-4 sm:p-5 flex flex-col items-center text-center shadow-xl shadow-rose-950/40 relative overflow-hidden group">
          <div className="absolute top-0 inset-x-0 h-1 bg-rose-400" />
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-rose-600 text-white flex items-center justify-center mb-2 sm:mb-3 shadow-lg">
            <X className="w-7 h-7 sm:w-8 sm:h-8 stroke-[3.5]" />
          </div>
          <span className="text-4xl sm:text-5xl font-black text-white tracking-tight drop-shadow">
            {wrong}
          </span>
          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-rose-300 mt-1">
            Incorrect
          </span>
          <span className="text-[11px] sm:text-xs font-semibold text-rose-100/70 mt-0.5">
            0 matches ({wrongPct}%)
          </span>
        </div>
      </div>

      {/* Visual Distribution Progress Bar */}
      <div className="w-full bg-white/10 rounded-full h-3.5 sm:h-4 overflow-hidden flex p-0.5 border border-white/20 shadow-inner">
        {correct > 0 && (
          <div
            style={{ width: `${correctPct}%` }}
            className="h-full bg-emerald-400 rounded-l-full transition-all duration-700"
            title={`All Correct: ${correct} (${correctPct}%)`}
          />
        )}
        {partial > 0 && (
          <div
            style={{ width: `${partialPct}%` }}
            className={`h-full bg-amber-400 transition-all duration-700 ${
              correct === 0 ? 'rounded-l-full' : ''
            } ${wrong === 0 ? 'rounded-r-full' : ''}`}
            title={`Partial: ${partial} (${partialPct}%)`}
          />
        )}
        {wrong > 0 && (
          <div
            style={{ width: `${wrongPct}%` }}
            className="h-full bg-rose-500 rounded-r-full transition-all duration-700"
            title={`Incorrect: ${wrong} (${wrongPct}%)`}
          />
        )}
      </div>
    </div>
  );
};
