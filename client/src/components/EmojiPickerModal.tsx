import React, { useState, useEffect } from 'react';
import { X, Dices, Check, Sparkles } from 'lucide-react';

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

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-fade-in select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose Your Avatar"
        className="w-full max-w-md bg-slate-900 border-2 border-white/20 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col text-white max-h-[92dvh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg sm:text-xl font-black">Choose Your Avatar</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Current Preview & Randomize */}
        <div className="flex items-center justify-between my-3.5 px-3 py-2.5 rounded-2xl bg-white/5 border border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#46178F] to-[#1368CE] border-2 border-white/40 shadow-lg flex items-center justify-center text-3xl transition-transform ${
                animating ? 'scale-125 rotate-12' : 'scale-100'
              }`}
            >
              {selected}
            </div>
            <div>
              <span className="text-[11px] font-bold text-white/60 uppercase tracking-wider block">
                Selected Avatar
              </span>
              <span className="text-sm font-extrabold text-white">Looking good!</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRandomize}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md transition-all active:scale-95 cursor-pointer"
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
                ? 'bg-[#1368CE] text-white shadow-md'
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
                  ? 'bg-[#1368CE] text-white shadow-md'
                  : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        {/* Emojis Grid */}
        <div className="flex-1 overflow-y-auto p-1.5 rounded-2xl bg-black/30 border border-white/10 min-h-0">
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
                      ? 'bg-[#1368CE] border-2 border-white scale-105 shadow-lg shadow-blue-500/40 ring-2 ring-blue-400'
                      : 'bg-white/5 hover:bg-white/20 border border-white/5 hover:scale-105'
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
            className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-[2] py-3 rounded-xl bg-[#26890C] hover:bg-[#1e6e09] text-white font-black text-sm shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Use this Avatar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
