import React from 'react';

interface TimerCircleProps {
  remainingSeconds: number;
  totalSeconds: number;
  size?: number;
}

export const TimerCircle: React.FC<TimerCircleProps> = ({
  remainingSeconds,
  totalSeconds,
  size = 110,
}) => {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
  const strokeDashoffset = circumference - progress * circumference;

  const isUrgent = remainingSeconds <= 5;
  const strokeColor = isUrgent ? '#E21B3C' : '#864CBF';

  return (
    <div
      className="relative flex items-center justify-center rounded-full shadow-2xl bg-white/10 backdrop-blur-md"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.25)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Animated countdown circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-black tracking-tight leading-none ${
            isUrgent ? 'text-[#ff4d6d] scale-110' : 'text-white'
          } transition-transform duration-200`}
          style={{ fontSize: size * 0.4 }}
        >
          {remainingSeconds}
        </span>
      </div>
    </div>
  );
};
