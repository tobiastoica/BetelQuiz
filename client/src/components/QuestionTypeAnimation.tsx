import React from 'react';
import { QuestionType } from '../types/quiz';

interface QuestionTypeAnimationProps {
  type: QuestionType;
  size?: number;
  className?: string;
  showLabel?: boolean;
}

export const QuestionTypeAnimation: React.FC<QuestionTypeAnimationProps> = ({
  type,
  size = 120,
  className = '',
  showLabel = true,
}) => {
  const renderSVG = () => {
    switch (type) {
      case 'quiz':
        return (
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 140 140" className="overflow-visible">
              <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.3" />
                </filter>
              </defs>

              {/* Central spinning orbit track */}
              <circle cx="70" cy="70" r="42" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeDasharray="4 4" />

              {/* Red Triangle ▲ */}
              <g className="origin-[70px_70px] animate-[spin_4s_linear_infinite]">
                <g transform="translate(70, 26) scale(0.9)" filter="url(#shadow)">
                  <polygon points="0,-16 16,14 -16,14" fill="#E21B3C" stroke="#fff" strokeWidth="2" />
                </g>
              </g>

              {/* Blue Diamond ◆ */}
              <g className="origin-[70px_70px] animate-[spin_4s_linear_infinite_reverse]">
                <g transform="translate(114, 70) scale(0.9)" filter="url(#shadow)">
                  <polygon points="0,-15 15,0 0,15 -15,0" fill="#1368CE" stroke="#fff" strokeWidth="2" />
                </g>
              </g>

              {/* Yellow Circle ● */}
              <g className="origin-[70px_70px] animate-[spin_4s_linear_infinite]">
                <g transform="translate(70, 114) scale(0.9)" filter="url(#shadow)">
                  <circle cx="0" cy="0" r="14" fill="#D89E00" stroke="#fff" strokeWidth="2" />
                </g>
              </g>

              {/* Green Square ■ */}
              <g className="origin-[70px_70px] animate-[spin_4s_linear_infinite_reverse]">
                <g transform="translate(26, 70) scale(0.9)" filter="url(#shadow)">
                  <rect x="-13" y="-13" width="26" height="26" rx="4" fill="#26890C" stroke="#fff" strokeWidth="2" />
                </g>
              </g>

              {/* Center bouncing Kahoot K! badge */}
              <circle cx="70" cy="70" r="18" fill="#46178F" stroke="#fff" strokeWidth="3" filter="url(#shadow)" className="animate-pulse" />
              <text x="70" y="77" fill="#fff" fontSize="18" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">
                ?
              </text>
            </svg>
          </div>
        );

      case 'true_false':
        return (
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 140 140" className="overflow-visible">
              <defs>
                <filter id="tf-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="6" stdDeviation="5" floodOpacity="0.35" />
                </filter>
              </defs>

              {/* Blue Card True (juggling left-right tilt) */}
              <g className="animate-[bounce_2s_infinite]">
                <g transform="translate(36, 40) rotate(-12)" filter="url(#tf-glow)">
                  <rect x="0" y="0" width="46" height="60" rx="8" fill="#1368CE" stroke="#fff" strokeWidth="2.5" />
                  {/* Diamond shape */}
                  <polygon points="23,16 33,26 23,36 13,26" fill="#fff" />
                  {/* Checkmark */}
                  <path d="M16 46 L22 52 L32 40" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </g>

              {/* Red Card False (juggling right-left tilt) */}
              <g className="animate-[bounce_2s_infinite_0.5s]">
                <g transform="translate(68, 38) rotate(14)" filter="url(#tf-glow)">
                  <rect x="0" y="0" width="46" height="60" rx="8" fill="#E21B3C" stroke="#fff" strokeWidth="2.5" />
                  {/* Triangle shape */}
                  <polygon points="23,16 33,34 13,34" fill="#fff" />
                  {/* X mark */}
                  <path d="M17 42 L29 54 M29 42 L17 54" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                </g>
              </g>

              {/* Floating Sparkles */}
              <circle cx="28" cy="24" r="3" fill="#FFD700" className="animate-ping" />
              <circle cx="118" cy="30" r="3.5" fill="#FFD700" className="animate-pulse" />
            </svg>
          </div>
        );

      case 'yes_no':
        return (
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 140 140" className="overflow-visible">
              {/* Green Yes Speech Bubble */}
              <g className="animate-[bounce_1.8s_infinite]">
                <g transform="translate(18, 25)">
                  <rect x="0" y="0" width="54" height="42" rx="12" fill="#26890C" stroke="#fff" strokeWidth="3" />
                  <polygon points="22,42 32,54 36,42" fill="#26890C" stroke="#fff" strokeWidth="2" />
                  <text x="27" y="27" fill="#fff" fontSize="16" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">
                    YES!
                  </text>
                </g>
              </g>

              {/* Red No Speech Bubble */}
              <g className="animate-[bounce_1.8s_infinite_0.6s]">
                <g transform="translate(68, 62)">
                  <rect x="0" y="0" width="54" height="42" rx="12" fill="#E21B3C" stroke="#fff" strokeWidth="3" />
                  <polygon points="20,0 26,-12 34,0" fill="#E21B3C" stroke="#fff" strokeWidth="2" />
                  <text x="27" y="27" fill="#fff" fontSize="16" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">
                    NO!
                  </text>
                </g>
              </g>
            </svg>
          </div>
        );

      case 'puzzle':
        return (
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 140 140" className="overflow-visible">
              {/* 4 Juggling / Sliding Puzzle Blocks */}
              {/* Block 1 */}
              <g className="animate-[bounce_2s_infinite]">
                <g transform="translate(24, 24)">
                  <rect x="0" y="0" width="40" height="40" rx="8" fill="#E21B3C" stroke="#fff" strokeWidth="2.5" />
                  <circle cx="40" cy="20" r="6" fill="#E21B3C" stroke="#fff" strokeWidth="2" />
                  <text x="20" y="26" fill="#fff" fontSize="18" fontWeight="900" textAnchor="middle">1</text>
                </g>
              </g>

              {/* Block 2 */}
              <g className="animate-[bounce_2s_infinite_0.4s]">
                <g transform="translate(76, 24)">
                  <rect x="0" y="0" width="40" height="40" rx="8" fill="#1368CE" stroke="#fff" strokeWidth="2.5" />
                  <circle cx="20" cy="40" r="6" fill="#1368CE" stroke="#fff" strokeWidth="2" />
                  <text x="20" y="26" fill="#fff" fontSize="18" fontWeight="900" textAnchor="middle">2</text>
                </g>
              </g>

              {/* Block 3 */}
              <g className="animate-[bounce_2s_infinite_0.8s]">
                <g transform="translate(24, 76)">
                  <rect x="0" y="0" width="40" height="40" rx="8" fill="#D89E00" stroke="#fff" strokeWidth="2.5" />
                  <text x="20" y="26" fill="#fff" fontSize="18" fontWeight="900" textAnchor="middle">3</text>
                </g>
              </g>

              {/* Block 4 */}
              <g className="animate-[bounce_2s_infinite_1.2s]">
                <g transform="translate(76, 76)">
                  <rect x="0" y="0" width="40" height="40" rx="8" fill="#26890C" stroke="#fff" strokeWidth="2.5" />
                  <text x="20" y="26" fill="#fff" fontSize="18" fontWeight="900" textAnchor="middle">4</text>
                </g>
              </g>
            </svg>
          </div>
        );

      case 'number_guess':
        return (
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 140 140" className="overflow-visible">
              <defs>
                <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#1368CE" />
                  <stop offset="50%" stopColor="#D89E00" />
                  <stop offset="100%" stopColor="#26890C" />
                </linearGradient>
              </defs>

              {/* Gauge arc */}
              <path
                d="M 25 95 A 50 50 0 0 1 115 95"
                fill="none"
                stroke="url(#gaugeGrad)"
                strokeWidth="12"
                strokeLinecap="round"
              />

              {/* Center Pivot */}
              <circle cx="70" cy="95" r="9" fill="#fff" stroke="#33106A" strokeWidth="3" />

              {/* Swinging Needle Pointer */}
              <g className="origin-[70px_95px] animate-[pulse_1.5s_ease-in-out_infinite]">
                <line x1="70" y1="95" x2="88" y2="48" stroke="#E21B3C" strokeWidth="4" strokeLinecap="round" />
                <circle cx="88" cy="48" r="5" fill="#E21B3C" stroke="#fff" strokeWidth="1.5" />
              </g>

              {/* Juggling Numbers Floating Above */}
              <g className="animate-bounce">
                <rect x="52" y="16" width="36" height="24" rx="6" fill="#46178F" stroke="#FFD700" strokeWidth="2" />
                <text x="70" y="33" fill="#FFD700" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="monospace">
                  100%
                </text>
              </g>

              <text x="22" y="118" fill="#fff" fontSize="11" fontWeight="800">Min</text>
              <text x="98" y="118" fill="#fff" fontSize="11" fontWeight="800">Max</text>
            </svg>
          </div>
        );

      case 'word_guess':
        return (
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 140 140" className="overflow-visible">
              <defs>
                <filter id="shadow-wg" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.3" />
                </filter>
              </defs>
              <rect x="20" y="35" width="100" height="70" rx="16" fill="#1368CE" stroke="#fff" strokeWidth="2" filter="url(#shadow-wg)" />
              <line x1="35" y1="75" x2="55" y2="75" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <line x1="60" y1="75" x2="80" y2="75" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <line x1="85" y1="75" x2="105" y2="75" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <g className="animate-pulse">
                <rect x="58" y="55" width="24" height="16" rx="4" fill="#26890C" stroke="#fff" strokeWidth="1" />
                <text x="70" y="67" fill="#fff" fontSize="11" fontWeight="900" textAnchor="middle">
                  Abc
                </text>
              </g>
            </svg>
          </div>
        );

      case 'picture_reveal':
        return (
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 140 140" className="overflow-visible">
              <defs>
                <filter id="shadow-pr" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.3" />
                </filter>
              </defs>
              <rect x="25" y="25" width="90" height="90" rx="14" fill="#46178F" stroke="#fff" strokeWidth="2" filter="url(#shadow-pr)" />
              <circle cx="85" cy="55" r="14" fill="#D89E00" />
              <polygon points="35,95 65,65 95,95" fill="#26890C" />
              <rect x="30" y="30" width="24" height="24" rx="4" fill="#1368CE" opacity="0.9" />
              <rect x="58" y="30" width="24" height="24" rx="4" fill="#1368CE" opacity="0.9" />
              <rect x="86" y="30" width="24" height="24" rx="4" fill="#1368CE" opacity="0.2" className="animate-ping" />
              <rect x="30" y="58" width="24" height="24" rx="4" fill="#1368CE" opacity="0.1" />
              <rect x="58" y="58" width="24" height="24" rx="4" fill="#1368CE" opacity="0.85" />
              <rect x="86" y="58" width="24" height="24" rx="4" fill="#1368CE" opacity="0.9" />
              <rect x="30" y="86" width="24" height="24" rx="4" fill="#1368CE" opacity="0.9" />
              <rect x="58" y="86" width="24" height="24" rx="4" fill="#1368CE" opacity="0.9" />
              <rect x="86" y="86" width="24" height="24" rx="4" fill="#1368CE" opacity="0.9" />
            </svg>
          </div>
        );

      default:
        return null;
    }
  };

  const getLabel = () => {
    switch (type) {
      case 'quiz':
        return 'Quiz';
      case 'true_false':
        return 'True or False';
      case 'yes_no':
        return 'Yes / No';
      case 'puzzle':
        return 'Puzzle (Ranking)';
      case 'number_guess':
        return 'Number Guessing';
      case 'word_guess':
        return 'Fill in the Blank';
      case 'picture_reveal':
        return 'Picture Reveal';
    }
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      {renderSVG()}
      {showLabel && (
        <span className="mt-2 text-xs font-black uppercase tracking-wider text-white/90 drop-shadow">
          {getLabel()}
        </span>
      )}
    </div>
  );
};
