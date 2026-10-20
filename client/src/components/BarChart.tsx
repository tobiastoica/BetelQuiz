import React from 'react';
import { KAHOOT_COLORS, ShapeIcon } from './ShapeIcon';
import type { AnswerOption } from '../types/quiz';

interface BarChartProps {
  options: AnswerOption[];
  voteDistribution: Record<string, number>;
  totalAnswers: number;
}

export const BarChart: React.FC<BarChartProps> = ({
  options,
  voteDistribution,
  totalAnswers,
}) => {
  const maxVotes = Math.max(1, ...Object.values(voteDistribution));

  return (
    <div className="flex items-end justify-center gap-4 sm:gap-6 md:gap-8 h-40 sm:h-48 md:h-56 px-4 sm:px-8 py-2 w-full max-w-5xl mx-auto">
      {options.map((opt, idx) => {
        const count = voteDistribution[opt.id] || 0;
        const itemIdx = opt.colorIndex ?? idx;
        const color = KAHOOT_COLORS[itemIdx % KAHOOT_COLORS.length];
        const heightPercent = totalAnswers > 0 ? Math.max(14, (count / maxVotes) * 100) : 10;

        return (
          <div
            key={opt.id}
            className="flex-1 flex flex-col items-center justify-end h-full max-w-[150px]"
          >
            {/* Animated Bar */}
            <div
              className={`w-full ${color.bg} rounded-t-2xl shadow-2xl relative flex flex-col items-center justify-end pb-3 transition-all duration-700 ease-out border-t-2 border-x-2 border-white/40`}
              style={{
                height: `${heightPercent}%`,
                minHeight: '48px',
              }}
            >
              <div className="flex items-center gap-2 text-white font-black text-xl sm:text-2xl drop-shadow-md">
                <ShapeIcon index={itemIdx} size={24} />
                <span>{count}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
