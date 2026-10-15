import React from 'react';
import { Target, Award, Users } from 'lucide-react';

interface NumberGuess {
  userUuid: string;
  nickname: string;
  avatar: string;
  guess: number;
  distance: number;
}

interface NumberGuessDistributionProps {
  target: number;
  min: number;
  max: number;
  guesses: NumberGuess[];
}

export const NumberGuessDistribution: React.FC<NumberGuessDistributionProps> = ({
  target,
  min,
  max,
  guesses,
}) => {
  const range = Math.max(1, max - min);
  const targetPercent = Math.max(0, Math.min(100, ((target - min) / range) * 100));

  const closestGuess = guesses.length > 0 ? guesses[0] : null;
  const avgGuess =
    guesses.length > 0
      ? Math.round(guesses.reduce((sum, g) => sum + g.guess, 0) / guesses.length)
      : null;

  return (
    <div className="w-full max-w-4xl mx-auto bg-white/95 backdrop-blur-md rounded-3xl p-6 md:p-8 shadow-2xl text-slate-800 border-2 border-slate-200 animate-float-up">
      {/* Target Header Banner */}
      <div className="flex flex-col items-center mb-8">
        <div className="inline-flex items-center gap-2 bg-[#26890C] text-white px-6 py-2 rounded-full font-black text-sm uppercase tracking-wider shadow-md mb-2">
          <Target className="w-5 h-5" />
          <span>Correct Target Answer</span>
        </div>
        <div className="text-5xl md:text-6xl font-black text-[#26890C] font-mono tracking-tight animate-bounce-in">
          {target}
        </div>
      </div>

      {/* Number Line Visualizer */}
      <div className="relative my-10 px-4">
        {/* Track */}
        <div className="h-6 w-full bg-gradient-to-r from-blue-500 via-amber-400 to-emerald-500 rounded-full shadow-inner relative" />

        {/* Min & Max Labels */}
        <div className="flex justify-between text-xs font-black text-slate-500 mt-2 px-1">
          <span>Min: {min}</span>
          <span>Max: {max}</span>
        </div>

        {/* Target Pin Marker */}
        <div
          className="absolute top-0 -translate-x-1/2 flex flex-col items-center pointer-events-none z-20"
          style={{ left: `${targetPercent}%` }}
        >
          {/* Target Flag Pin */}
          <div className="-top-10 relative flex flex-col items-center">
            <div className="bg-[#26890C] text-white font-black text-xs px-3 py-1 rounded-full shadow-lg flex items-center gap-1 border-2 border-white animate-pulse">
              <span>🎯 {target}</span>
            </div>
            <div className="w-0.5 h-6 bg-[#26890C]" />
          </div>
        </div>

        {/* Player Guess Pins */}
        <div className="relative w-full min-h-[120px] mt-4">
          {(() => {
            const pinPositions = guesses.map((player, idx) => {
              const playerPercent = Math.max(0, Math.min(100, ((player.guess - min) / range) * 100));
              return { player, idx, percent: playerPercent };
            });

            // Sort by percent to detect proximity and assign vertical rows
            const sorted = [...pinPositions].sort((a, b) => a.percent - b.percent);
            const staggerMap = new Map<number, number>();
            let lastPercent = -100;
            let currentRow = 0;

            for (const item of sorted) {
              if (Math.abs(item.percent - lastPercent) < 9) {
                currentRow = (currentRow + 1) % 3;
              } else {
                currentRow = 0;
              }
              staggerMap.set(item.idx, currentRow);
              lastPercent = item.percent;
            }

            return pinPositions.map(({ player, idx, percent }) => {
              const isClosest = idx === 0;
              const row = staggerMap.get(idx) || 0;
              const topOffset = row * 34;

              return (
                <div
                  key={player.userUuid}
                  className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-700 animate-float-up"
                  style={{
                    left: `${percent}%`,
                    top: `${topOffset}px`,
                    zIndex: isClosest ? 40 : 10 + (idx % 10) + row,
                  }}
                >
                  {/* Pointer Arrow */}
                  <div className="w-0 h-0 border-x-4 border-x-transparent border-b-6 border-b-[#46178F]" />

                  {/* Player Tag */}
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs shadow-lg whitespace-nowrap border-2 ${
                      isClosest
                        ? 'bg-[#FFD700] text-amber-950 border-amber-400 font-black scale-110 ring-2 ring-amber-300'
                        : 'bg-[#46178F] text-white border-white'
                    }`}
                  >
                    <span className="text-base">{player.avatar}</span>
                    <span>{player.nickname}:</span>
                    <span className="font-mono font-black">{player.guess}</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 pt-6 border-t border-slate-200">
        {/* Closest Guess */}
        <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FFD700] text-amber-950 flex items-center justify-center font-black shrink-0 shadow">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
              Closest Guess
            </p>
            <p className="text-base font-black text-amber-950">
              {closestGuess ? `${closestGuess.nickname} (${closestGuess.guess})` : 'None'}
            </p>
          </div>
        </div>

        {/* Average Guess */}
        <div className="bg-purple-50 rounded-2xl p-4 border border-purple-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#46178F] text-white flex items-center justify-center font-black shrink-0 shadow">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#46178F] uppercase tracking-wider">
              Average Guess
            </p>
            <p className="text-base font-black text-slate-800">
              {avgGuess !== null ? avgGuess : 'N/A'}
            </p>
          </div>
        </div>

        {/* Total Guesses */}
        <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1368CE] text-white flex items-center justify-center font-black shrink-0 shadow">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#1368CE] uppercase tracking-wider">
              Total Players
            </p>
            <p className="text-base font-black text-slate-800">
              {guesses.length} Guessed
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
