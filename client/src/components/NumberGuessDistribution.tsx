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
    <div className="w-full max-w-4xl mx-auto cosmic-surface rounded-3xl p-6 md:p-8 shadow-2xl text-[#FBF6E9] border border-white/12 animate-float-up">
      {/* Target Header Banner */}
      <div className="flex flex-col items-center mb-8">
        <div className="inline-flex items-center gap-2 bg-teal-500/20 border border-teal-500/40 text-[#5CC7B8] px-6 py-2 rounded-full font-black text-sm uppercase tracking-wider shadow-md mb-2">
          <Target className="w-5 h-5" />
          <span>Correct Target Answer</span>
        </div>
        <div className="text-5xl md:text-6xl font-black text-[#FAC747] font-mono tracking-tight animate-bounce-in drop-shadow-[0_0_20px_rgba(250,199,71,0.4)]">
          {target}
        </div>
      </div>

      {/* Number Line Visualizer */}
      <div className="relative my-10 px-4">
        {/* Track */}
        <div className="h-6 w-full bg-gradient-to-r from-sky-500 via-amber-400 to-teal-400 rounded-full shadow-inner relative" />

        {/* Min & Max Labels */}
        <div className="flex justify-between text-xs font-black text-white/60 mt-2 px-1">
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
            <div className="bg-[#2F8F84] text-white font-black text-xs px-3 py-1 rounded-full shadow-lg flex items-center gap-1 border-2 border-white animate-pulse">
              <span>🎯 {target}</span>
            </div>
            <div className="w-0.5 h-6 bg-[#2F8F84]" />
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
                  <div className="w-0 h-0 border-x-4 border-x-transparent border-b-6 border-b-[#182046]" />

                  {/* Player Tag */}
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs shadow-lg whitespace-nowrap border ${
                      isClosest
                        ? 'btn-gold text-[#2A1A00] font-black scale-110 shadow-[0_0_15px_rgba(250,199,71,0.4)]'
                        : 'bg-[#182046] text-[#FBF6E9] border-white/20'
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 pt-6 border-t border-white/10">
        {/* Closest Guess */}
        <div className="bg-amber-400/10 rounded-2xl p-4 border border-amber-400/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#FAC747] to-[#DB941F] text-[#2A1A00] flex items-center justify-center font-black shrink-0 shadow">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#FAC747] uppercase tracking-wider">
              Closest Guess
            </p>
            <p className="text-base font-black text-[#FBF6E9]">
              {closestGuess ? `${closestGuess.nickname} (${closestGuess.guess})` : 'None'}
            </p>
          </div>
        </div>

        {/* Average Guess */}
        <div className="bg-[#131938]/80 rounded-2xl p-4 border border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-500/30 text-[#5CC7B8] flex items-center justify-center font-black shrink-0 shadow">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
              Average Guess
            </p>
            <p className="text-base font-black text-[#FBF6E9]">
              {avgGuess !== null ? avgGuess : 'N/A'}
            </p>
          </div>
        </div>

        {/* Total Guesses */}
        <div className="bg-[#131938]/80 rounded-2xl p-4 border border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 text-white flex items-center justify-center font-black shrink-0 shadow">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
              Total Players
            </p>
            <p className="text-base font-black text-[#FBF6E9]">
              {guesses.length} Guessed
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
