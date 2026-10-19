import React from 'react';
import { CheckCircle2, MessageSquare } from 'lucide-react';

interface WordCloudRevealProps {
  wordSubmissions?: Record<string, number>;
  acceptedAnswers?: string[];
  theme?: string;
}

export const WordCloudReveal: React.FC<WordCloudRevealProps> = ({
  wordSubmissions = {},
  acceptedAnswers = [],
}) => {
  const entries = Object.entries(wordSubmissions);

  const normalizeWord = (w: any): string =>
    typeof w === 'string'
      ? w.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      : '';

  // Normalize accepted answers for fast lookup
  const acceptedNormalized = new Set(
    (acceptedAnswers || []).map(normalizeWord).filter(Boolean)
  );

  const isAccepted = (word: any) => {
    const norm = normalizeWord(word);
    return norm ? acceptedNormalized.has(norm) : false;
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-[#0F1433]/85 backdrop-blur-2xl rounded-3xl border border-white/10 text-[#FBF6E9] shadow-2xl max-w-2xl mx-auto text-center">
        <MessageSquare className="w-16 h-16 text-white/40 mb-3 animate-pulse" />
        <h3 className="text-2xl font-black mb-1">No Word Submissions</h3>
        <p className="text-white/60 text-sm">No players submitted words for this question.</p>
        {acceptedAnswers.length > 0 && (
          <div className="mt-6 p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl w-full">
            <span className="text-xs uppercase tracking-wider text-emerald-300 font-bold block mb-1">
              Accepted Answers
            </span>
            <div className="flex flex-wrap gap-2 justify-center">
              {(acceptedAnswers || []).filter((ans) => Boolean(ans && String(ans).trim())).map((ans, i) => (
                <span
                  key={i}
                  className="px-3 py-1 bg-emerald-500/25 text-emerald-200 font-bold rounded-lg text-sm border border-emerald-400/30"
                >
                  {ans}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Find max and min counts for scaling font sizes
  const counts = entries.map(([, count]) => count);
  const maxCount = Math.max(...counts, 1);
  const minCount = Math.min(...counts, 1);

  // Soft palette colors for non-accepted or varying words
  const bubbleGradients = [
    'from-indigo-500 to-purple-600',
    'from-blue-500 to-cyan-600',
    'from-violet-500 to-fuchsia-600',
    'from-amber-500 to-orange-600',
    'from-pink-500 to-rose-600',
  ];

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col items-center">
      {/* Accepted answers banner */}
      {acceptedAnswers.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2 px-6 py-3 bg-emerald-500/15 border border-emerald-500/30 backdrop-blur-md rounded-2xl shadow-lg">
          <span className="text-xs font-black uppercase tracking-widest text-emerald-300 flex items-center gap-1.5 mr-2">
            <CheckCircle2 className="w-4 h-4" /> Correct Answers:
          </span>
          {acceptedAnswers.map((ans, i) => (
            <span
              key={i}
              className="px-3 py-1 bg-emerald-500/30 text-emerald-100 font-black text-sm rounded-xl border border-emerald-400/40 shadow"
            >
              {ans}
            </span>
          ))}
        </div>
      )}

      {/* Cloud Container */}
      <div className="w-full bg-[#0F1433]/85 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-12 shadow-[0_16px_48px_rgba(0,0,0,0.5)] flex flex-wrap items-center justify-center gap-4 sm:gap-6 min-h-[320px] transition-all">
        {entries.map(([word, count], idx) => {
          const accepted = isAccepted(word);
          // Scale size smoothly between text-base and text-5xl
          const ratio = maxCount === minCount ? 0.5 : (count - minCount) / (maxCount - minCount);
          const fontSizeRem = 1.1 + ratio * 2.2; // 1.1rem to 3.3rem

          const gradient = bubbleGradients[idx % bubbleGradients.length];

          return (
            <div
              key={word}
              style={{ fontSize: `${fontSizeRem}rem` }}
              className={`inline-flex items-center gap-2 font-black px-5 py-2.5 rounded-2xl shadow-xl transition-all duration-300 transform hover:scale-110 cursor-default select-none animate-in fade-in zoom-in-75 ${
                accepted
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white ring-4 ring-emerald-400/40 shadow-emerald-500/30'
                  : `bg-gradient-to-r ${gradient} text-white/95 ring-1 ring-white/20 shadow-black/40`
              }`}
            >
              {accepted && <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
              <span>{word}</span>
              {count > 1 && (
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm ml-1">
                  ×{count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-xs font-semibold text-white/50 tracking-wider uppercase">
        {entries.length} Unique {entries.length === 1 ? 'Word' : 'Words'} Submitted
      </div>
    </div>
  );
};
