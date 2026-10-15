import React, { useState, useRef } from 'react';
import { X, Upload, Sliders, Palette, Clock, Trophy, Check, Image as ImageIcon, Sparkles } from 'lucide-react';
import { THEMES } from '../utils/theme';
import { uploadImage } from '../utils/api';
import type { Quiz } from '../types/quiz';

interface QuizSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  quiz: Quiz;
  onSave: (settings: {
    title: string;
    description: string;
    theme: string;
    backgroundImage?: string;
    defaultTimeLimit: number;
    defaultPoints: number;
    overrideAllQuestions: boolean;
  }) => void;
}

export const QuizSettingsModal: React.FC<QuizSettingsModalProps> = ({
  isOpen,
  onClose,
  quiz,
  onSave,
}) => {
  const [title, setTitle] = useState(quiz.title || 'Untitled Quiz');
  const [description, setDescription] = useState(quiz.description || '');
  const [theme, setTheme] = useState(quiz.theme || 'spring');
  const [backgroundImage, setBackgroundImage] = useState<string | undefined>(quiz.backgroundImage);
  const [defaultTimeLimit, setDefaultTimeLimit] = useState<number>(quiz.defaultTimeLimit || 20);
  const [defaultPoints, setDefaultPoints] = useState<number>(
    quiz.defaultPoints !== undefined ? quiz.defaultPoints : 1000
  );
  const [overrideAllQuestions, setOverrideAllQuestions] = useState<boolean>(true);
  const [isUploadingBg, setIsUploadingBg] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingBg(true);
    try {
      const url = await uploadImage(file);
      setBackgroundImage(url);
    } catch (err: any) {
      alert(err.message || 'Background upload failed');
    } finally {
      setIsUploadingBg(false);
    }
  };

  const handleConfirm = () => {
    onSave({
      title: title.trim() || 'Untitled Quiz',
      description,
      theme,
      backgroundImage,
      defaultTimeLimit,
      defaultPoints,
      overrideAllQuestions,
    });
    onClose();
  };

  const TIME_OPTIONS = [5, 10, 15, 20, 30, 60, 90, 120, 240];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-fade-in select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quiz Global Settings and Defaults"
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden border border-slate-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#46178F] text-white shadow">
              <Sliders className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">
                BetelQuiz Global Settings & Defaults
              </h2>
              <p className="text-xs text-slate-500 font-semibold">
                Set global theme, default time, and default score for all questions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Section 1: Quiz Information */}
          <div className="space-y-3.5">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <span>General Information</span>
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Quiz Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter quiz title..."
                className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-200 font-bold text-slate-900 focus:border-[#46178F] focus:outline-none text-base transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Description (Optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What is this quiz about?"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-200 font-medium text-slate-800 focus:border-[#46178F] focus:outline-none text-sm transition-colors"
              />
            </div>
          </div>

          {/* Section 2: Global Game Rules (Time Limit & Points) */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#46178F] flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              <span>Global Question Rules</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Global Time Limit */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Clock className="w-4 h-4 text-slate-600" />
                    <label className="text-xs font-black uppercase text-slate-700">
                      Global Time Limit
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mb-3">
                    Default seconds allowed per question
                  </p>
                </div>

                <select
                  value={defaultTimeLimit}
                  onChange={(e) => setDefaultTimeLimit(Number(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white focus:border-[#46178F] focus:outline-none cursor-pointer"
                >
                  {TIME_OPTIONS.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec} seconds
                    </option>
                  ))}
                </select>
              </div>

              {/* Global Score / Points */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-slate-600" />
                      <label className="text-xs font-black uppercase text-slate-700">
                        Global Question Score
                      </label>
                    </div>
                    <span className="text-xs font-black px-2 py-0.5 rounded-full bg-purple-100 text-[#46178F]">
                      {defaultPoints} pts
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mb-3">
                    Default base score awarded
                  </p>
                </div>

                <div>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {[0, 1000, 2000].map((pts) => (
                      <button
                        key={pts}
                        type="button"
                        onClick={() => setDefaultPoints(pts)}
                        className={`py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          defaultPoints === pts
                            ? 'bg-[#46178F] text-white shadow'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {pts === 0 ? '0 pts' : pts === 1000 ? '1000 pts' : '2000 pts'}
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="2000"
                    step="100"
                    value={defaultPoints}
                    onChange={(e) => setDefaultPoints(Number(e.target.value))}
                    className="w-full accent-[#46178F] cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Global Theme & Background */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Palette className="w-4 h-4 text-slate-600" />
              <span>Global Theme & Background</span>
            </h3>

            {/* Themes Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {THEMES.map((t) => {
                const isSelected = theme === t.id && !backgroundImage;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTheme(t.id);
                      setBackgroundImage(undefined);
                    }}
                    className={`h-16 rounded-xl p-2.5 text-left flex flex-col justify-between overflow-hidden shadow-sm border-2 transition-all bg-gradient-to-br ${
                      t.gradient
                    } cursor-pointer ${
                      isSelected
                        ? 'border-[#46178F] ring-3 ring-[#46178F]/30 scale-[1.02]'
                        : 'border-transparent hover:scale-[1.01]'
                    }`}
                  >
                    <span
                      className={`text-xs font-black ${
                        t.isDark ? 'text-white' : 'text-slate-800'
                      }`}
                    >
                      {t.name}
                    </span>
                    {isSelected && (
                      <div className="self-end w-4 h-4 rounded-full bg-white text-[#46178F] flex items-center justify-center shadow">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom Background Upload */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {backgroundImage ? (
                  <div className="w-14 h-10 rounded-lg overflow-hidden border border-slate-300 shrink-0 bg-black/20">
                    <img
                      src={backgroundImage}
                      alt="Global BG"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-500 flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <span className="text-xs font-black text-slate-800 block truncate">
                    {backgroundImage ? 'Custom Background Active' : 'Custom Background Image'}
                  </span>
                  <span className="text-[11px] text-slate-500 block truncate">
                    {backgroundImage ? 'Applies to all questions' : 'Upload an image as the global backdrop'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {backgroundImage && (
                  <button
                    type="button"
                    onClick={() => setBackgroundImage(undefined)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  disabled={isUploadingBg}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs flex items-center gap-1.5 shadow transition-all cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isUploadingBg ? 'Uploading...' : backgroundImage ? 'Change' : 'Upload Image'}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleBgUpload}
                />
              </div>
            </div>
          </div>

          {/* Section 4: Override Behavior (Crucial User Requirement) */}
          <div className="p-4 rounded-2xl bg-purple-50/80 border-2 border-[#46178F]/30 flex items-start gap-3">
            <input
              type="checkbox"
              id="overrideQuestions"
              checked={overrideAllQuestions}
              onChange={(e) => setOverrideAllQuestions(e.target.checked)}
              className="mt-0.5 w-5 h-5 accent-[#46178F] rounded cursor-pointer shrink-0"
            />
            <label htmlFor="overrideQuestions" className="cursor-pointer select-none">
              <span className="font-black text-sm text-slate-900 block">
                Apply & override all current questions ({quiz.questions.length} questions)
              </span>
              <span className="text-xs text-slate-600 font-semibold block mt-0.5 leading-relaxed">
                When enabled, all existing questions in this quiz will immediately adopt this global theme, time limit ({defaultTimeLimit}s), and score ({defaultPoints} pts). Any question can still be customized afterwards, and question-level settings will take precedence.
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/60">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 font-bold text-slate-700 text-sm transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-6 py-2.5 rounded-xl bg-[#46178F] hover:bg-[#33106A] text-white font-black text-sm shadow-lg transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Save & Apply Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};
