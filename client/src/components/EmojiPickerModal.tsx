import React, { useState, useEffect } from 'react';
import { X, Dices, Check, Sparkles } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';

export const EMOJI_CATEGORIES = [
  {
    id: 'animals',
    name: 'Animals',
    icon: '🐾',
    emojis: [
      '🦊', '🐼', '🦁', '🐯', '🐨', '🐵', '🐶', '🐱', '🦄', '🐬',
      '🦉', '🐙', '🐸', '🦖', '🐝', '🐧', '🐺', '🐮', '🐷', '🐰',
      '🦅', '🦈', '🐻', '🦥', '🦩', '🦔'
    ],
  },
  {
    id: 'power',
    name: 'Power & Fun',
    icon: '⚡',
    emojis: [
      '🚀', '⚡', '🌟', '💥', '🔥', '🎮', '🛹', '🎸', '👑', '🏆',
      '🎯', '💎', '🛸', '🍕', '🍦', '🍔', '🍿', '🍩', '🥑', '🏎️',
      '⚽', '🏀', '🎉', '🥊', '🧩', '🧨'
    ],
  },
  {
    id: 'faces',
    name: 'Characters',
    icon: '😎',
    emojis: [
      '😎', '🤠', '🥳', '🤓', '🤖', '👽', '👻', '👾', '🥷', '🦸',
      '🧙', '😻', '🧠', '🧐', '🤩', '😜', '😇', '🎭', '🧛', '🧜',
      '🕺', '💃', '🕵️', '🦹', '🧞', '🧟'
    ],
  },
];

export const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

interface EmojiPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEmoji: string;
  onSelectEmoji: (emoji: string) => void;
}

export const EmojiPickerModal: React.FC<EmojiPickerModalProps> = ({
  isOpen,
  onClose,
  currentEmoji,
  onSelectEmoji,
}) => {
  const [selected, setSelected] = useState<string>(currentEmoji || '🦊');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [animating, setAnimating] = useState<boolean>(false);

  // Reset selected avatar whenever modal opens or currentEmoji prop updates
  useEffect(() => {
    if (isOpen) {
      setSelected(currentEmoji || '🦊');
      setActiveCategory('all');
    }
  }, [isOpen, currentEmoji]);

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  const displayedEmojis =
    activeCategory === 'all'
      ? ALL_EMOJIS
      : EMOJI_CATEGORIES.find((c) => c.id === activeCategory)?.emojis || ALL_EMOJIS;

  const handleRandomize = () => {
    setAnimating(true);
    const randomEmoji = ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];
    setSelected(randomEmoji);
    setTimeout(() => setAnimating(false), 300);
  };

  const handleConfirm = () => {
    onSelectEmoji(selected);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose Your Avatar"
        className="w-full max-w-md bg-[#0F1433]/98 cosmic-surface border border-white/10 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col text-[#FBF6E9] max-h-[92dvh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#FAC747]" />
            <h3 className="text-lg sm:text-xl font-black text-[#FBF6E9]">Choose Your Avatar</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Current Preview & Randomize */}
        <div className="flex items-center justify-between my-3.5 px-3.5 py-3 rounded-2xl bg-[#131938]/80 border border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#FAC747] to-[#DB941F] text-[#2A1A00] border-2 border-white/40 shadow-lg flex items-center justify-center text-3xl transition-transform ${
                animating ? 'scale-125 rotate-12' : 'scale-100'
              }`}
            >
              {selected}
            </div>
            <div>
              <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider block">
                Selected Avatar
              </span>
              <span className="text-sm font-extrabold text-[#FBF6E9]">Looking good!</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRandomize}
            className="btn-gold flex items-center gap-1.5 px-3 py-2 rounded-xl text-[#2A1A00] font-black text-xs shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <Dices className="w-4 h-4 stroke-[2.5]" />
            <span>Surprise Me</span>
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1.5 mb-2.5 overflow-x-auto pb-1 shrink-0 no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 ${
              activeCategory === 'all'
                ? 'btn-gold text-[#2A1A00] shadow-md'
                : 'bg-white/10 text-white/70 hover:bg-white/15'
            }`}
          >
            ✨ All ({ALL_EMOJIS.length})
          </button>
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 ${
                activeCategory === cat.id
                  ? 'btn-gold text-[#2A1A00] shadow-md'
                  : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        {/* Emojis Grid */}
        <div className="flex-1 overflow-y-auto p-2 rounded-2xl bg-[#131938]/90 border border-white/10 min-h-0">
          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
            {displayedEmojis.map((emoji, idx) => {
              const isPicked = selected === emoji;
              return (
                <button
                  key={`${emoji}-${idx}`}
                  type="button"
                  onClick={() => setSelected(emoji)}
                  className={`h-12 rounded-xl flex items-center justify-center text-2xl transition-all cursor-pointer active:scale-90 ${
                    isPicked
                      ? 'bg-amber-400/20 border-2 border-[#FAC747] scale-105 shadow-[0_0_15px_rgba(250,199,71,0.4)]'
                      : 'bg-white/5 hover:bg-white/15 border border-white/5 hover:scale-105'
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-3 mt-2 border-t border-white/10 flex gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white/80 hover:text-white font-bold text-sm transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="btn-gold flex-[2] py-3 rounded-xl text-[#2A1A00] font-black text-sm shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Use this Avatar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
