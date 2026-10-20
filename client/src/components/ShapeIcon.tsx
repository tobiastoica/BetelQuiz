import React from 'react';

export const KAHOOT_COLORS = [
  { name: 'Red', bg: 'bg-[#E21B3C]', border: 'border-[#c01330]', hover: 'hover:bg-[#c01330]', hex: '#E21B3C', shape: 'triangle' },
  { name: 'Blue', bg: 'bg-[#1368CE]', border: 'border-[#0f54a8]', hover: 'hover:bg-[#0f54a8]', hex: '#1368CE', shape: 'diamond' },
  { name: 'Yellow', bg: 'bg-[#D89E00]', border: 'border-[#b58500]', hover: 'hover:bg-[#b58500]', hex: '#D89E00', shape: 'circle' },
  { name: 'Green', bg: 'bg-[#26890C]', border: 'border-[#1e6e09]', hover: 'hover:bg-[#1e6e09]', hex: '#26890C', shape: 'square' },
  { name: 'Purple', bg: 'bg-[#864CBF]', border: 'border-[#6c39a0]', hover: 'hover:bg-[#6c39a0]', hex: '#864CBF', shape: 'star' },
  { name: 'Teal', bg: 'bg-[#05888B]', border: 'border-[#046e70]', hover: 'hover:bg-[#046e70]', hex: '#05888B', shape: 'hexagon' },
];

interface ShapeIconProps {
  index: number;
  className?: string;
  size?: number;
}

export const ShapeIcon: React.FC<ShapeIconProps> = ({ index, className = '', size = 28 }) => {
  const shapeType = KAHOOT_COLORS[index % KAHOOT_COLORS.length].shape;

  switch (shapeType) {
    case 'triangle':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M12 3L22 20H2L12 3Z" />
        </svg>
      );
    case 'diamond':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M12 2L22 12L12 22L2 12L12 2Z" />
        </svg>
      );
    case 'circle':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    case 'square':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      );
    case 'star':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
        </svg>
      );
    case 'hexagon':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" />
        </svg>
      );
    default:
      return null;
  }
};
