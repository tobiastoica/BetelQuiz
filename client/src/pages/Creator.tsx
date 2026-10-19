import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  Sliders,
  Palette,
  CheckCircle2,
  Circle,
  Upload,
  X,
  Hash,
  ListOrdered,
  Globe,
} from 'lucide-react';

import type { Quiz, Question, QuestionType, AnswerOption } from '../types/quiz';
import { fetchQuiz, createQuiz, updateQuiz, uploadImage, checkAuth } from '../utils/api';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { KAHOOT_COLORS, ShapeIcon } from '../components/ShapeIcon';
import { THEMES, getThemeClasses } from '../utils/theme';
import { QuestionTypeAnimation } from '../components/QuestionTypeAnimation';
import { QuestionListReorder } from '../components/QuestionListReorder';
import { QuizSettingsModal } from '../components/QuizSettingsModal';

function createDefaultOptions(type: QuestionType): AnswerOption[] {
  switch (type) {
    case 'quiz':
    case 'picture_reveal':
      return [
        { id: uuidv4(), text: '', isCorrect: true },
        { id: uuidv4(), text: '', isCorrect: false },
        { id: uuidv4(), text: '', isCorrect: false },
        { id: uuidv4(), text: '', isCorrect: false },
      ];
    case 'true_false':
      return [
        { id: uuidv4(), text: 'True', isCorrect: true },
        { id: uuidv4(), text: 'False', isCorrect: false },
      ];
    case 'yes_no':
      return [
        { id: uuidv4(), text: 'Yes', isCorrect: true },
        { id: uuidv4(), text: 'No', isCorrect: false },
      ];
    case 'puzzle':
      return [
        { id: uuidv4(), text: '', isCorrect: true, order: 0 },
        { id: uuidv4(), text: '', isCorrect: true, order: 1 },
        { id: uuidv4(), text: '', isCorrect: true, order: 2 },
        { id: uuidv4(), text: '', isCorrect: true, order: 3 },
      ];
    case 'word_guess':
    case 'number_guess':
    default:
      return [];
  }
}

export const Creator: React.FC = () => {
  const { quizId } = useParams<{ quizId?: string }>();
  const navigate = useNavigate();

  // Quiz state with lazy initializer to preserve component purity
  const [quiz, setQuiz] = useState<Quiz>(() => ({
    id: quizId || uuidv4(),
    title: 'Untitled Quiz',
    description: '',
    coverImage: '',
    theme: 'spring',
    defaultTimeLimit: 20,
    defaultPoints: 1000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: uuidv4(),
        type: 'quiz',
        title: '',
        timeLimit: 20,
        points: 1000,
        theme: 'spring',
        isMultiSelect: false,
        options: createDefaultOptions('quiz'),
      },
    ],
  }));

  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'properties' | 'themes'>('properties');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEscapeKey(() => {
    setShowAddModal(false);
    setShowSettingsModal(false);
  }, showAddModal || showSettingsModal);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  // Snapshot tracking in pure React state
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>(() =>
    JSON.stringify(quiz)
  );

  useEffect(() => {
    checkAuth().then((res) => {
      if (!res.authenticated) {
        navigate('/admin/login');
      }
    });

    if (quizId) {
      fetchQuiz(quizId)
        .then((existing) => {
          if (existing) {
            const loadedQuiz: Quiz = {
              ...existing,
              defaultTimeLimit: existing.defaultTimeLimit ?? 20,
              defaultPoints: existing.defaultPoints ?? 1000,
              theme: existing.theme || 'spring',
            };
            setQuiz(loadedQuiz);
            setLastSavedSnapshot(JSON.stringify(loadedQuiz));
          }
        })
        .catch((err) => {
          console.error('Failed to load quiz:', err);
        });
    }
  }, [quizId, navigate]);

  const isDirty = Boolean(
    lastSavedSnapshot &&
    JSON.stringify(quiz) !== lastSavedSnapshot
  );

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleExit = () => {
    if (isDirty) {
      const confirmExit = window.confirm(
        'You have unsaved changes. Are you sure you want to exit without saving?'
      );
      if (!confirmExit) return;
    }
    navigate('/admin/dashboard');
  };

  const currentQuestion = quiz.questions[activeQuestionIndex] || quiz.questions[0];

  // Update current question helper
  const updateCurrentQuestion = (updates: Partial<Question>) => {
    setQuiz((prev) => {
      if (!prev.questions.length) return prev;
      const safeIndex = Math.max(0, Math.min(prev.questions.length - 1, activeQuestionIndex));
      const updatedQuestions = [...prev.questions];
      updatedQuestions[safeIndex] = {
        ...updatedQuestions[safeIndex],
        ...updates,
      };
      return { ...prev, questions: updatedQuestions };
    });
  };

  // Change question type in-place for active question
  const handleChangeQuestionType = (type: QuestionType) => {
    if (!currentQuestion) return;
    const canReuse =
      (currentQuestion.type === 'quiz' || currentQuestion.type === 'picture_reveal') &&
      (type === 'quiz' || type === 'picture_reveal');

    let newOptions: AnswerOption[] = [];
    if (canReuse && currentQuestion.options && currentQuestion.options.length >= 2) {
      newOptions = currentQuestion.options.map((o) => ({ ...o, isCorrect: Boolean(o.isCorrect) }));
      if (!newOptions.some((o) => o.isCorrect)) {
        newOptions[0].isCorrect = true;
      }
    } else {
      newOptions = createDefaultOptions(type);
    }

    updateCurrentQuestion({
      type,
      options: newOptions,
      isMultiSelect: type === 'quiz' ? Boolean(currentQuestion.isMultiSelect) : false,
      numberTarget: type === 'number_guess' ? (currentQuestion.numberTarget ?? 50) : undefined,
      numberMin: type === 'number_guess' ? (currentQuestion.numberMin ?? 0) : undefined,
      numberMax: type === 'number_guess' ? (currentQuestion.numberMax ?? 100) : undefined,
      tileLevel: type === 'picture_reveal' ? (currentQuestion.tileLevel ?? 'medium') : undefined,
      acceptedAnswers: type === 'word_guess' ? (currentQuestion.acceptedAnswers ?? []) : undefined,
    });
  };

  // Add question
  const handleAddQuestion = (type: QuestionType) => {
    const newQuestion: Question = {
      id: uuidv4(),
      type,
      title: '',
      timeLimit: quiz.defaultTimeLimit || 20,
      points: quiz.defaultPoints !== undefined ? quiz.defaultPoints : 1000,
      theme: quiz.theme || 'spring',
      backgroundImage: quiz.backgroundImage,
      isMultiSelect: false,
      options: createDefaultOptions(type),
      numberTarget: type === 'number_guess' ? 50 : undefined,
      numberMin: type === 'number_guess' ? 0 : undefined,
      numberMax: type === 'number_guess' ? 100 : undefined,
      tileLevel: type === 'picture_reveal' ? 'medium' : undefined,
      acceptedAnswers: type === 'word_guess' ? [] : undefined,
      allowMultipleAnswers: false,
      fuzzyMatching: true,
      fuzzyScorePercentage: 80,
      caseSensitive: false,
    };

    setQuiz((prev) => ({
      ...prev,
      questions: [...prev.questions, newQuestion],
    }));

    setActiveQuestionIndex(quiz.questions.length);
    setShowAddModal(false);
  };

  // Duplicate question
  const handleDuplicateQuestion = (idx: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const source = quiz.questions[idx];
    const duplicated: Question = {
      ...source,
      id: uuidv4(),
      options: (source.options || []).map((o) => ({ ...o, id: uuidv4() })),
    };

    const newQuestions = [...quiz.questions];
    newQuestions.splice(idx + 1, 0, duplicated);

    setQuiz((prev) => ({ ...prev, questions: newQuestions }));
    setActiveQuestionIndex(idx + 1);
  };

  // Delete question
  const handleDeleteQuestion = (idx: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (quiz.questions.length <= 1) {
      alert('A quiz must have at least 1 question!');
      return;
    }

    const newQuestions = quiz.questions.filter((_, i) => i !== idx);
    setQuiz((prev) => ({ ...prev, questions: newQuestions }));
    setActiveQuestionIndex((prev) => Math.max(0, Math.min(prev, newQuestions.length - 1)));
  };

  // Reorder questions via drag & drop
  const handleReorderQuestions = (newQuestions: Question[], newActiveIndex: number) => {
    setQuiz((prev) => ({ ...prev, questions: newQuestions }));
    setActiveQuestionIndex(newActiveIndex);
  };

  // Save & Apply Global Settings from modal
  const handleApplyGlobalSettings = (newSettings: {
    title: string;
    description: string;
    theme: string;
    backgroundImage?: string;
    defaultTimeLimit: number;
    defaultPoints: number;
    overrideAllQuestions: boolean;
  }) => {
    setQuiz((prev) => {
      const updatedQuiz: Quiz = {
        ...prev,
        title: newSettings.title,
        description: newSettings.description,
        theme: newSettings.theme,
        backgroundImage: newSettings.backgroundImage,
        defaultTimeLimit: newSettings.defaultTimeLimit,
        defaultPoints: newSettings.defaultPoints,
      };

      if (newSettings.overrideAllQuestions) {
        updatedQuiz.questions = prev.questions.map((q) => ({
          ...q,
          timeLimit: newSettings.defaultTimeLimit,
          points: newSettings.defaultPoints,
          theme: newSettings.theme,
          backgroundImage: newSettings.backgroundImage,
        }));
      }

      return updatedQuiz;
    });

    setToastMsg(
      newSettings.overrideAllQuestions
        ? `Applied global settings to all ${quiz.questions.length} questions!`
        : 'Global settings updated!'
    );
    setTimeout(() => setToastMsg(''), 3000);
  };

  // Open Global Settings panel with time limit preset
  const handleOpenGlobalSettingsWithTimeLimit = (timeLimit: number) => {
    setQuiz((prev) => ({
      ...prev,
      defaultTimeLimit: timeLimit,
    }));
    setShowSettingsModal(true);
  };

  // Open Global Settings panel with points preset
  const handleOpenGlobalSettingsWithPoints = (points: number) => {
    setQuiz((prev) => ({
      ...prev,
      defaultPoints: points,
    }));
    setShowSettingsModal(true);
  };

  // Open Global Settings panel with theme & background preset
  const handleOpenGlobalSettingsWithTheme = (theme?: string, backgroundImage?: string) => {
    setQuiz((prev) => ({
      ...prev,
      theme: theme || prev.theme,
      backgroundImage,
    }));
    setShowSettingsModal(true);
  };

  // Quick action: Set time limit as global and apply to all questions
  const handleApplyTimeLimitToAll = (timeLimit: number) => {
    setQuiz((prev) => ({
      ...prev,
      defaultTimeLimit: timeLimit,
      questions: prev.questions.map((q) => ({ ...q, timeLimit })),
    }));
    setToastMsg(`Set ${timeLimit}s as global time limit for all questions!`);
    setTimeout(() => setToastMsg(''), 2500);
  };

  // Quick action: Set points as global and apply to all questions
  const handleApplyPointsToAll = (points: number) => {
    setQuiz((prev) => ({
      ...prev,
      defaultPoints: points,
      questions: prev.questions.map((q) => ({ ...q, points })),
    }));
    setToastMsg(`Set ${points} pts as global score for all questions!`);
    setTimeout(() => setToastMsg(''), 2500);
  };

  // Quick action: Set theme & background as global and apply to all questions
  const handleApplyThemeToAll = (theme?: string, backgroundImage?: string) => {
    setQuiz((prev) => ({
      ...prev,
      theme: theme || prev.theme,
      backgroundImage,
      questions: prev.questions.map((q) => ({
        ...q,
        theme: theme || prev.theme,
        backgroundImage,
      })),
    }));
    setToastMsg('Set as global theme & background for all questions!');
    setTimeout(() => setToastMsg(''), 2500);
  };

  // Toggle answer correct
  const toggleAnswerCorrect = (optIdx: number) => {
    if (!currentQuestion) return;
    const isMulti = Boolean(currentQuestion.isMultiSelect);
    const updatedOptions = currentQuestion.options.map((opt, idx) => {
      if (idx === optIdx) {
        return { ...opt, isCorrect: !opt.isCorrect };
      }
      if (!isMulti) {
        return { ...opt, isCorrect: false };
      }
      return opt;
    });

    updateCurrentQuestion({ options: updatedOptions });
  };

  // Add more answer options (up to 6)
  const handleAddOption = () => {
    if (!currentQuestion || currentQuestion.options.length >= 6) return;
    const newOpt: AnswerOption = {
      id: uuidv4(),
      text: '',
      isCorrect: false,
    };
    updateCurrentQuestion({ options: [...currentQuestion.options, newOpt] });
  };

  // Remove option
  const handleRemoveOption = (optIdx: number) => {
    if (!currentQuestion || currentQuestion.options.length <= 2) return;
    const newOptions = currentQuestion.options.filter((_, idx) => idx !== optIdx);
    updateCurrentQuestion({ options: newOptions });
  };

  // Handle image upload
  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const url = await uploadImage(file);
      updateCurrentQuestion({ image: url });
    } catch (err: any) {
      alert(err.message || 'Image upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  // Handle custom background image upload
  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadImage(file);
      updateCurrentQuestion({ backgroundImage: url });
    } catch (err: any) {
      alert(err.message || 'Background upload failed');
    }
  };

  // Save quiz with comprehensive validation
  const handleSave = async () => {
    // 1. Validate quiz title
    if (!quiz.title || quiz.title.trim() === '') {
      alert('Please enter a title for your quiz before saving.');
      return;
    }

    // 2. Validate questions
    if (!quiz.questions || quiz.questions.length === 0) {
      alert('A quiz must have at least one question.');
      return;
    }

    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const qNum = i + 1;

      // Validate question title
      if (!q.title || q.title.trim() === '') {
        alert(`Question #${qNum} is missing a question title. Please enter a title before saving.`);
        setActiveQuestionIndex(i);
        return;
      }

      // Validate quiz, true_false, yes_no, picture_reveal
      if (q.type === 'quiz' || q.type === 'true_false' || q.type === 'yes_no' || q.type === 'picture_reveal') {
        const filledOptions = (q.options || []).filter((opt) => opt.text && opt.text.trim() !== '');
        if (filledOptions.length < 2) {
          alert(`Question #${qNum} (${q.type.replace('_', ' ')}) must have at least 2 answer choices filled in.`);
          setActiveQuestionIndex(i);
          return;
        }

        const hasCorrectOption = filledOptions.some((opt) => opt.isCorrect);
        if (!hasCorrectOption) {
          alert(`Question #${qNum} (${q.type.replace('_', ' ')}) must have at least 1 correct answer selected.`);
          setActiveQuestionIndex(i);
          return;
        }

        if (q.type === 'picture_reveal' && (!q.image || q.image.trim() === '')) {
          alert(`Question #${qNum} (Picture Reveal) requires an image to reveal. Please upload an image.`);
          setActiveQuestionIndex(i);
          return;
        }
      }

      // Validate puzzle
      if (q.type === 'puzzle') {
        if (!q.options || q.options.length < 2) {
          alert(`Question #${qNum} (Puzzle) must have at least 2 items to arrange.`);
          setActiveQuestionIndex(i);
          return;
        }
        const emptyOpt = q.options.find((opt) => !opt.text || opt.text.trim() === '');
        if (emptyOpt) {
          alert(`Question #${qNum} (Puzzle) has empty items. Please enter text for all puzzle items.`);
          setActiveQuestionIndex(i);
          return;
        }
      }

      // Validate word_guess
      if (q.type === 'word_guess') {
        if (!q.acceptedAnswers || q.acceptedAnswers.length === 0) {
          alert(`Question #${qNum} (Word Guess) must have at least 1 accepted answer.`);
          setActiveQuestionIndex(i);
          return;
        }
      }

      // Validate number_guess target within [min, max]
      if (q.type === 'number_guess') {
        const minVal = q.numberMin ?? 0;
        const maxVal = q.numberMax ?? 100;
        const targetVal = q.numberTarget;

        if (minVal > maxVal) {
          alert(`Question #${qNum} (Number Guess) has invalid bounds: Min (${minVal}) cannot be greater than Max (${maxVal}).`);
          setActiveQuestionIndex(i);
          return;
        }

        if (
          targetVal === undefined ||
          targetVal === null ||
          isNaN(targetVal) ||
          targetVal < minVal ||
          targetVal > maxVal
        ) {
          alert(`Question #${qNum} (Number Guess) target (${targetVal ?? 'empty'}) must be within the range [${minVal}, ${maxVal}].`);
          setActiveQuestionIndex(i);
          return;
        }
      }
    }

    // Sanitize questions: prune empty options for choice questions and normalize puzzle items so visual order matches stored order (order = index)
    const sanitizedQuiz: Quiz = {
      ...quiz,
      questions: quiz.questions.map((q) => {
        if (['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(q.type)) {
          return {
            ...q,
            options: (q.options || []).filter((opt) => Boolean(opt.text && opt.text.trim() !== '')),
          };
        }
        if (q.type === 'puzzle') {
          return {
            ...q,
            options: (q.options || []).map((opt, idx) => ({
              ...opt,
              order: idx,
              isCorrect: true,
            })),
          };
        }
        return q;
      }),
    };

    setIsSaving(true);
    try {
      if (quizId) {
        await updateQuiz(quizId, sanitizedQuiz);
      } else {
        await createQuiz(sanitizedQuiz);
      }
      setQuiz(sanitizedQuiz);
      setLastSavedSnapshot(JSON.stringify(sanitizedQuiz));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to save quiz');
    } finally {
      setIsSaving(false);
    }
  };

  const themeStyle = getThemeClasses(currentQuestion?.theme || quiz.theme, currentQuestion?.backgroundImage);

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-900 text-slate-800 overflow-hidden font-sans">
      {/* Top Navigation Bar */}
      <header className="h-14 bg-[#0F1433]/90 backdrop-blur-xl border-b border-white/10 px-4 flex items-center justify-between z-20 shrink-0 text-[#FBF6E9]">
        <div className="flex items-center gap-4">
          <button
            onClick={handleExit}
            className="flex items-center gap-1.5 text-white/60 hover:text-white text-xs font-bold transition-colors cursor-pointer py-1 px-2.5 rounded-lg hover:bg-white/5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Exit</span>
          </button>

          <div className="h-5 w-px bg-white/10" />

          {/* Logo */}
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FAC747] to-[#DB941F] text-[#2A1A00] flex items-center justify-center font-black text-xs shadow-md">
              BQ
            </span>
            <span className="font-black text-[#FBF6E9] tracking-tight text-base">BetelQuiz</span>
          </div>

          {/* Title input */}
          <div className="flex items-center gap-2 ml-2">
            <input
              type="text"
              value={quiz.title}
              onChange={(e) => setQuiz({ ...quiz, title: e.target.value })}
              placeholder="Enter quiz title..."
              className="px-3 py-1.5 text-sm font-bold text-[#FBF6E9] bg-white/5 hover:bg-white/10 focus:bg-[#080A1F] rounded-xl border border-transparent hover:border-white/10 focus:border-[#FAC747] focus:outline-none transition-all w-56 md:w-80 placeholder:text-white/30"
            />

            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-[#FAC747] border border-white/10 text-xs font-bold transition-all cursor-pointer shadow-xs ml-1"
              title="Quiz Settings & Global Defaults"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Global Settings</span>
            </button>
          </div>
        </div>

        {/* Right action buttons */}
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 animate-bounce-in">
              <CheckCircle2 className="w-4 h-4" />
              Saved to disk!
            </span>
          )}

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-gold flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-black shadow-lg shadow-amber-500/25 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving...' : 'Save Quiz'}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Questions list thumbnails with Drag & Drop Reordering */}
        <aside className="w-64 bg-[#0B0F24]/95 border-r border-white/10 flex flex-col shrink-0 overflow-y-auto p-3 text-[#FBF6E9]">
          <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-white/10 shrink-0">
            <span className="text-[11px] font-black uppercase tracking-wider text-white/50">
              Questions ({quiz.questions.length})
            </span>
            <span className="text-[10px] text-[#FAC747] font-bold bg-amber-400/10 border border-[#FAC747]/20 px-2 py-0.5 rounded-full">
              Drag to reorder
            </span>
          </div>

          <QuestionListReorder
            questions={quiz.questions}
            activeQuestionIndex={activeQuestionIndex}
            defaultTimeLimit={quiz.defaultTimeLimit ?? 20}
            defaultPoints={quiz.defaultPoints ?? 1000}
            onSelectQuestion={setActiveQuestionIndex}
            onReorderQuestions={handleReorderQuestions}
            onDuplicateQuestion={handleDuplicateQuestion}
            onDeleteQuestion={handleDeleteQuestion}
          />

          {/* Add Question Button */}
          <div className="pt-3 border-t border-white/10 shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-gold w-full py-2.5 px-3 rounded-full text-xs font-black flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Add Question</span>
            </button>
          </div>
        </aside>

        {/* Center: Interactive Question Canvas */}
        <main
          className={`flex-1 overflow-y-auto flex flex-col justify-between p-6 transition-all relative ${themeStyle.className}`}
          style={themeStyle.style}
        >
          {/* Top Question Input */}
          <div className="w-full max-w-4xl mx-auto mb-4">
            <div className="cosmic-surface rounded-2xl shadow-xl border border-white/12 p-4">
              <input
                type="text"
                value={currentQuestion?.title || ''}
                onChange={(e) => updateCurrentQuestion({ title: e.target.value })}
                placeholder="Start typing your question..."
                className="w-full text-center text-xl md:text-2xl font-black text-[#FBF6E9] placeholder:text-white/30 focus:outline-none bg-transparent"
              />
            </div>
          </div>

          {/* Center Media Upload & Preview */}
          <div className="flex-1 flex flex-col items-center justify-center my-3 max-w-2xl mx-auto w-full">
            {currentQuestion?.image ? (
              <div className="relative group rounded-2xl overflow-hidden shadow-2xl border-4 border-white bg-black/40 max-h-64 md:max-h-72">
                <img
                  src={currentQuestion.image}
                  alt="Question Media"
                  className="w-full h-full object-contain max-h-64"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-white text-slate-800 font-bold text-xs rounded-lg shadow hover:bg-slate-100"
                  >
                    Replace Image
                  </button>
                  <button
                    onClick={() =>
                      updateCurrentQuestion({ backgroundImage: currentQuestion.image })
                    }
                    className="btn-gold px-3 py-1.5 text-[#2A1A00] font-black text-xs rounded-lg shadow cursor-pointer"
                  >
                    Use as background
                  </button>
                  <button
                    onClick={() => updateCurrentQuestion({ image: '' })}
                    className="p-1.5 bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg transition-colors cursor-pointer"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-md h-48 border-2 border-dashed border-white/20 hover:border-[#FAC747]/60 bg-[#0F1433]/70 hover:bg-[#131938]/80 backdrop-blur-xl rounded-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-all shadow-xl group"
              >
                <div className="w-12 h-12 rounded-full bg-amber-400/10 border border-amber-400/20 text-[#FAC747] flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="font-extrabold text-[#FBF6E9] text-base drop-shadow">
                  {uploadingImage ? 'Uploading image...' : 'Find and insert media'}
                </p>
                <p className="text-xs text-white/50 mt-1">Upload file or drag here</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFileChange}
            />
          </div>

          {/* Bottom Area: Depends on Question Type */}
          <div className="w-full max-w-5xl mx-auto mt-2">
            {/* 1. QUIZ / TRUE_FALSE / YES_NO / PICTURE_REVEAL */}
            {(currentQuestion?.type === 'quiz' ||
              currentQuestion?.type === 'true_false' ||
              currentQuestion?.type === 'yes_no' ||
              currentQuestion?.type === 'picture_reveal') && (
              <div className="space-y-3">
                {currentQuestion.type === 'picture_reveal' && (
                  <div className="cosmic-surface rounded-2xl p-4 shadow-xl border border-white/10 flex flex-wrap items-center justify-between gap-3 text-[#FBF6E9]">
                    <div>
                      <span className="text-xs font-black uppercase text-[#FAC747] tracking-wider block">
                        Mystery Picture Reveal Grid Density
                      </span>
                      <span className="text-[11px] text-white/60">
                        Image will be covered and dissolve progressively as time ticks down!
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {(['small', 'medium', 'big'] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => updateCurrentQuestion({ tileLevel: lvl })}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition cursor-pointer ${
                            (currentQuestion.tileLevel || 'medium') === lvl
                              ? 'btn-gold text-[#2A1A00]'
                              : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {lvl} {lvl === 'small' ? '(3×3)' : lvl === 'medium' ? '(4×4)' : '(6×6)'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  className={`grid gap-3 ${
                    currentQuestion.options.length <= 4
                      ? 'grid-cols-1 md:grid-cols-2'
                      : 'grid-cols-1 md:grid-cols-3'
                  }`}
                >
                  {currentQuestion.options.map((opt, idx) => {
                    const color = KAHOOT_COLORS[idx % KAHOOT_COLORS.length];
                    return (
                      <div
                        key={opt.id}
                        className={`${color.bg} rounded-2xl p-3.5 shadow-xl border border-white/15 flex items-center justify-between gap-3 text-white transition-all hover:brightness-105`}
                      >
                        <div className="flex items-center gap-2 flex-1">
                          <ShapeIcon index={idx} size={24} className="shrink-0 drop-shadow" />
                          <input
                            type="text"
                            value={opt.text}
                            onChange={(e) => {
                              const newOpts = currentQuestion.options.map((o, i) =>
                                i === idx ? { ...o, text: e.target.value } : o
                              );
                              updateCurrentQuestion({ options: newOpts });
                            }}
                            placeholder={`Add answer ${idx + 1}`}
                            className="bg-transparent text-white font-black text-base md:text-lg placeholder:text-white/60 focus:outline-none flex-1"
                          />
                        </div>

                        {/* Correctness Toggle Checkmark */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {currentQuestion.options.length > 2 && (currentQuestion.type === 'quiz' || currentQuestion.type === 'picture_reveal') && (
                            <button
                              onClick={() => handleRemoveOption(idx)}
                              className="text-white/40 hover:text-white p-1 transition-colors"
                              title="Delete option"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => toggleAnswerCorrect(idx)}
                            className="p-1 hover:scale-110 transition-transform cursor-pointer"
                            title={opt.isCorrect ? 'Correct answer' : 'Mark as correct'}
                          >
                            {opt.isCorrect ? (
                              <CheckCircle2 className="w-7 h-7 text-white fill-[#26890C] drop-shadow" />
                            ) : (
                              <Circle className="w-7 h-7 text-white/60" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add more answers button (if quiz/picture_reveal and < 6) */}
                {(currentQuestion.type === 'quiz' || currentQuestion.type === 'picture_reveal') && currentQuestion.options.length < 6 && (
                  <div className="flex justify-center pt-1">
                    <button
                      onClick={handleAddOption}
                      className="px-4 py-2 bg-[#0F1433]/80 hover:bg-[#182046] border border-white/15 text-white/90 rounded-full font-bold text-xs flex items-center gap-1.5 backdrop-blur-md shadow-lg transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#FAC747]" />
                      <span>Add more answers ({currentQuestion.options.length}/6)</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 2. PUZZLE (RANKING) */}
            {currentQuestion?.type === 'puzzle' && (
              <div className="cosmic-surface rounded-2xl p-5 shadow-2xl border border-white/10 text-[#FBF6E9]">
                <div className="text-sm font-bold text-white/90 mb-3 flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-[#FAC747]" />
                  <span>Enter items in the correct target sequence (1st to 4th):</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {currentQuestion.options.map((opt, idx) => {
                    const color = KAHOOT_COLORS[idx % KAHOOT_COLORS.length];
                    return (
                      <div
                        key={opt.id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-[#131938]/80 text-[#FBF6E9]"
                      >
                        <span
                          className={`w-7 h-7 rounded-lg ${color.bg} text-white font-black text-sm flex items-center justify-center shrink-0 shadow-md`}
                        >
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          value={opt.text}
                          onChange={(e) => {
                            const newOpts = currentQuestion.options.map((o, i) =>
                              i === idx ? { ...o, text: e.target.value } : o
                            );
                            updateCurrentQuestion({ options: newOpts });
                          }}
                          placeholder={`Item ${idx + 1} in order...`}
                          className="bg-transparent text-[#FBF6E9] font-bold text-base flex-1 focus:outline-none placeholder:text-white/30"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. NUMBER GUESSING */}
            {currentQuestion?.type === 'number_guess' && (
              <div className="cosmic-surface rounded-2xl p-6 shadow-2xl border border-white/10 max-w-2xl mx-auto text-[#FBF6E9]">
                <div className="text-sm font-bold text-white/90 mb-4 flex items-center gap-2">
                  <Hash className="w-4 h-4 text-[#FAC747]" />
                  <span>Configure Target Number & Bounds:</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-white/60 uppercase mb-1">
                      Target Number
                    </label>
                    <input
                      type="number"
                      value={currentQuestion.numberTarget ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        updateCurrentQuestion({ numberTarget: val === '' ? undefined : Number(val) });
                      }}
                      className="w-full p-2.5 rounded-xl border border-white/10 bg-[#131938] font-black text-2xl text-center text-[#FAC747] focus:outline-none focus:border-[#FAC747]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-white/60 uppercase mb-1">
                      Min Range
                    </label>
                    <input
                      type="number"
                      value={currentQuestion.numberMin ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        updateCurrentQuestion({ numberMin: val === '' ? undefined : Number(val) });
                      }}
                      className="w-full p-2.5 rounded-xl border border-white/10 bg-[#131938] font-bold text-base text-center text-[#FBF6E9] focus:outline-none focus:border-[#FAC747]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-white/60 uppercase mb-1">
                      Max Range
                    </label>
                    <input
                      type="number"
                      value={currentQuestion.numberMax ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        updateCurrentQuestion({ numberMax: val === '' ? undefined : Number(val) });
                      }}
                      className="w-full p-2.5 rounded-xl border border-white/10 bg-[#131938] font-bold text-base text-center text-[#FBF6E9] focus:outline-none focus:border-[#FAC747]"
                    />
                  </div>
                </div>
                <p className="text-xs text-white/50 mt-3 text-center">
                  Players will use a slider to guess. The closer they are to the target, the more points they earn!
                </p>
              </div>
            )}

            {/* 4. WORD GUESS / FILL IN THE BLANK */}
            {currentQuestion?.type === 'word_guess' && (
              <div className="cosmic-surface rounded-2xl p-6 shadow-2xl border border-white/10 max-w-3xl mx-auto space-y-6 text-[#FBF6E9]">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-black uppercase tracking-wider text-[#FAC747]">
                      Accepted Correct Answers
                    </label>
                    <span className="text-xs text-white/50">
                      {(currentQuestion.acceptedAnswers || []).length} accepted
                    </span>
                  </div>

                  {/* Accepted answers chips */}
                  <div className="flex flex-wrap gap-2 mb-3 min-h-[44px] p-2 bg-[#131938] border border-white/10 rounded-xl items-center">
                    {(currentQuestion.acceptedAnswers || []).map((ans, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-500/15 border border-teal-500/40 text-teal-300 font-bold text-xs rounded-lg shadow-sm"
                      >
                        <span>{ans}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newAnswers = (currentQuestion.acceptedAnswers || []).filter((_, i) => i !== idx);
                            updateCurrentQuestion({ acceptedAnswers: newAnswers });
                          }}
                          className="text-teal-300 hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                    {(currentQuestion.acceptedAnswers || []).length === 0 && (
                      <span className="text-xs text-white/40 italic p-1">No accepted answers added yet</span>
                    )}
                  </div>

                  {/* Add accepted answer input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id="newAcceptedAnswerInput"
                      placeholder="Type an accepted answer and press Enter..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = (e.currentTarget.value || '').trim();
                          if (val) {
                            const existing = currentQuestion.acceptedAnswers || [];
                            if (!existing.includes(val)) {
                              updateCurrentQuestion({ acceptedAnswers: [...existing, val] });
                            }
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                      className="flex-1 p-2.5 rounded-xl border border-white/10 bg-[#131938] text-sm font-bold text-[#FBF6E9] placeholder:text-white/30 focus:outline-none focus:border-[#FAC747]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById('newAcceptedAnswerInput') as HTMLInputElement;
                        if (input && input.value.trim()) {
                          const val = input.value.trim();
                          const existing = currentQuestion.acceptedAnswers || [];
                          if (!existing.includes(val)) {
                            updateCurrentQuestion({ acceptedAnswers: [...existing, val] });
                          }
                          input.value = '';
                        }
                      }}
                      className="btn-gold px-4 py-2.5 rounded-xl font-bold text-xs text-[#2A1A00] shadow-md transition cursor-pointer"
                    >
                      Add Answer
                    </button>
                  </div>
                </div>

                {/* Configurations */}
                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                  {/* Fuzzy Matching Toggle */}
                  <div className="p-3 bg-[#131938]/80 border border-white/10 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-white/90 block">Fuzzy Typo Matching</span>
                      <span className="text-[11px] text-white/50">Allow minor spelling mistakes</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={currentQuestion.fuzzyMatching !== false}
                      onChange={(e) => updateCurrentQuestion({ fuzzyMatching: e.target.checked })}
                      className="w-5 h-5 accent-[#FAC747] rounded cursor-pointer"
                    />
                  </div>

                  {/* Multiple Answers Allowed */}
                  <div className="p-3 bg-[#131938]/80 border border-white/10 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-white/90 block">Allow Multiple Answers</span>
                      <span className="text-[11px] text-white/50">Players can submit multiple terms</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(currentQuestion.allowMultipleAnswers)}
                      onChange={(e) => updateCurrentQuestion({ allowMultipleAnswers: e.target.checked })}
                      className="w-5 h-5 accent-[#FAC747] rounded cursor-pointer"
                    />
                  </div>

                  {/* Fuzzy Score % Slider (if fuzzyMatching is on) */}
                  {currentQuestion.fuzzyMatching !== false && (
                    <div className="p-3 bg-[#131938]/80 border border-white/10 rounded-xl col-span-full">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-white/90">Fuzzy Match Score Weight</span>
                        <span className="text-xs font-black text-[#FAC747]">
                          {currentQuestion.fuzzyScorePercentage ?? 80}% of full points
                        </span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="100"
                        step="5"
                        value={currentQuestion.fuzzyScorePercentage ?? 80}
                        onChange={(e) => updateCurrentQuestion({ fuzzyScorePercentage: Number(e.target.value) })}
                        className="w-full accent-[#FAC747] cursor-pointer"
                      />
                    </div>
                  )}

                  {/* Case Sensitive */}
                  <div className="p-3 bg-[#131938]/80 border border-white/10 rounded-xl flex items-center justify-between col-span-full">
                    <div>
                      <span className="text-xs font-bold text-white/90 block">Strict Case Sensitivity</span>
                      <span className="text-[11px] text-white/50">Require exact capitalization</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(currentQuestion.caseSensitive)}
                      onChange={(e) => updateCurrentQuestion({ caseSensitive: e.target.checked })}
                      className="w-5 h-5 accent-[#FAC747] rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right Sidebar: Properties & Themes Panel */}
        <aside className="w-72 bg-[#0B0F24]/95 border-l border-white/10 flex flex-col shrink-0 text-[#FBF6E9]">
          {/* Tab buttons */}
          <div className="flex border-b border-white/10">
            <button
              onClick={() => setActiveTab('properties')}
              className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'properties'
                  ? 'border-b-2 border-[#FAC747] text-[#FAC747] bg-amber-400/5'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Properties</span>
            </button>
            <button
              onClick={() => setActiveTab('themes')}
              className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'themes'
                  ? 'border-b-2 border-[#FAC747] text-[#FAC747] bg-amber-400/5'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              <Palette className="w-4 h-4" />
              <span>Themes</span>
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1 space-y-6">
            {activeTab === 'properties' ? (
              <>
                {/* Question Type */}
                <div>
                  <label className="block text-xs font-bold uppercase text-white/60 mb-2">
                    Question Type
                  </label>
                  <select
                    value={currentQuestion?.type || 'quiz'}
                    onChange={(e) => handleChangeQuestionType(e.target.value as QuestionType)}
                    className="w-full p-2.5 rounded-xl border border-white/10 bg-[#131938] text-sm font-bold text-[#FBF6E9] focus:border-[#FAC747] focus:outline-none"
                  >
                    <option value="quiz" className="bg-[#0F1433] text-[#FBF6E9]">Quiz (Multiple Choice)</option>
                    <option value="true_false" className="bg-[#0F1433] text-[#FBF6E9]">True or False</option>
                    <option value="yes_no" className="bg-[#0F1433] text-[#FBF6E9]">Yes / No</option>
                    <option value="puzzle" className="bg-[#0F1433] text-[#FBF6E9]">Puzzle (Ranking)</option>
                    <option value="number_guess" className="bg-[#0F1433] text-[#FBF6E9]">Number Guessing</option>
                    <option value="word_guess" className="bg-[#0F1433] text-[#FBF6E9]">Fill in the Blank</option>
                    <option value="picture_reveal" className="bg-[#0F1433] text-[#FBF6E9]">Mystery Picture Reveal</option>
                  </select>
                </div>

                {/* Time Limit */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase text-white/60">
                      Time Limit
                    </label>
                    {currentQuestion &&
                      currentQuestion.timeLimit !== undefined &&
                      Number(currentQuestion.timeLimit) !== Number(quiz.defaultTimeLimit ?? 20) && (
                        <span className="text-[10px] font-bold text-[#FAC747] bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/30">
                          Custom
                        </span>
                      )}
                  </div>
                  <select
                    value={Number(currentQuestion?.timeLimit ?? (quiz.defaultTimeLimit ?? 20))}
                    onChange={(e) =>
                      updateCurrentQuestion({ timeLimit: Number(e.target.value) })
                    }
                    className="w-full p-2.5 rounded-xl border border-white/10 bg-[#131938] text-sm font-bold text-[#FBF6E9] focus:border-[#FAC747] focus:outline-none"
                  >
                    <option value={5} className="bg-[#0F1433] text-[#FBF6E9]">5 seconds</option>
                    <option value={10} className="bg-[#0F1433] text-[#FBF6E9]">10 seconds</option>
                    <option value={15} className="bg-[#0F1433] text-[#FBF6E9]">15 seconds</option>
                    <option value={20} className="bg-[#0F1433] text-[#FBF6E9]">20 seconds</option>
                    <option value={30} className="bg-[#0F1433] text-[#FBF6E9]">30 seconds</option>
                    <option value={60} className="bg-[#0F1433] text-[#FBF6E9]">60 seconds</option>
                    <option value={90} className="bg-[#0F1433] text-[#FBF6E9]">90 seconds</option>
                    <option value={120} className="bg-[#0F1433] text-[#FBF6E9]">120 seconds</option>
                    <option value={240} className="bg-[#0F1433] text-[#FBF6E9]">240 seconds</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleOpenGlobalSettingsWithTimeLimit(Number(currentQuestion?.timeLimit ?? (quiz.defaultTimeLimit ?? 20)))}
                    className="mt-2 py-1.5 px-2.5 rounded-lg text-[11px] font-bold text-[#FAC747] hover:text-[#DB941F] bg-amber-400/10 border border-amber-400/20 hover:border-amber-400/40 flex items-center justify-center gap-1.5 cursor-pointer transition-colors w-full"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Set {Number(currentQuestion?.timeLimit ?? (quiz.defaultTimeLimit ?? 20))}s as global for all questions</span>
                  </button>
                </div>

                {/* Points */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase text-white/60">
                      Points
                    </label>
                    <div className="flex items-center gap-2">
                      {currentQuestion &&
                        currentQuestion.points !== undefined &&
                        Number(currentQuestion.points) !== Number(quiz.defaultPoints ?? 1000) && (
                          <span className="text-[10px] font-bold text-[#FAC747] bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/30">
                            Custom
                          </span>
                        )}
                      <span className="text-sm font-black text-[#FAC747]">
                        {Number(currentQuestion?.points ?? (quiz.defaultPoints ?? 1000))} pts
                      </span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2000"
                    step="100"
                    value={Number(currentQuestion?.points ?? (quiz.defaultPoints ?? 1000))}
                    onChange={(e) =>
                      updateCurrentQuestion({ points: Number(e.target.value) })
                    }
                    className="w-full accent-[#FAC747] cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-white/40 font-bold mt-1">
                    <span>0 (None)</span>
                    <span>1000 (Standard)</span>
                    <span>2000 (Double)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenGlobalSettingsWithPoints(Number(currentQuestion?.points ?? (quiz.defaultPoints ?? 1000)))}
                    className="mt-2 py-1.5 px-2.5 rounded-lg text-[11px] font-bold text-[#FAC747] hover:text-[#DB941F] bg-amber-400/10 border border-amber-400/20 hover:border-amber-400/40 flex items-center justify-center gap-1.5 cursor-pointer transition-colors w-full"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Set {Number(currentQuestion?.points ?? (quiz.defaultPoints ?? 1000))} pts as global for all questions</span>
                  </button>
                </div>

                {/* Answer Options: Single vs Multi */}
                {currentQuestion?.type === 'quiz' && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-white/60 mb-2">
                      Answer Options
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateCurrentQuestion({ isMultiSelect: false })}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          !currentQuestion.isMultiSelect
                            ? 'btn-gold text-[#2A1A00] border-transparent shadow'
                            : 'bg-[#131938] text-white/70 border-white/10 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        Single Select
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCurrentQuestion({ isMultiSelect: true })}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          currentQuestion.isMultiSelect
                            ? 'btn-gold text-[#2A1A00] border-transparent shadow'
                            : 'bg-[#131938] text-white/70 border-white/10 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        Multi-Select
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Themes Tab */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-bold uppercase text-white/60">
                      Preset Themes
                    </label>
                    {currentQuestion &&
                      ((currentQuestion.theme && currentQuestion.theme !== (quiz.theme || 'spring')) ||
                        (currentQuestion.backgroundImage &&
                          currentQuestion.backgroundImage !== quiz.backgroundImage)) && (
                        <span className="text-[10px] font-bold text-[#FAC747] bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/30">
                          Custom
                        </span>
                      )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => {
                          updateCurrentQuestion({
                            theme: theme.id,
                            backgroundImage: undefined,
                          });
                        }}
                        className={`h-20 rounded-xl p-2.5 text-left flex flex-col justify-between overflow-hidden shadow-sm border-2 transition-all cursor-pointer bg-gradient-to-br ${
                          theme.gradient
                        } ${
                          (currentQuestion?.theme === theme.id &&
                            !currentQuestion.backgroundImage)
                            ? 'border-[#FAC747] ring-2 ring-[#FAC747]'
                            : 'border-transparent hover:scale-102 hover:border-white/30'
                        }`}
                      >
                        <span
                          className={`text-xs font-black ${
                            theme.isDark ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {theme.name}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Custom Background Upload */}
                  <div className="mt-6 pt-5 border-t border-white/10">
                    <label className="block text-xs font-bold uppercase text-white/60 mb-2">
                      Custom Background Image
                    </label>
                    <button
                      onClick={() => bgFileInputRef.current?.click()}
                      className="w-full py-3 rounded-xl border-2 border-dashed border-white/20 hover:border-[#FAC747]/60 bg-[#131938]/60 text-white/70 hover:text-[#FAC747] font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Upload Custom Background</span>
                    </button>
                    <input
                      ref={bgFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleBackgroundUpload}
                    />
                  </div>

                  {/* Set as global theme & background */}
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => handleOpenGlobalSettingsWithTheme(currentQuestion?.theme, currentQuestion?.backgroundImage)}
                      className="w-full py-2.5 px-3 bg-amber-400/10 hover:bg-amber-400/20 text-[#FAC747] rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 border border-amber-400/20 cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Set as global theme for all questions</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Question Type Modal (matching Image 1!) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose question type"
            className="cosmic-surface rounded-3xl max-w-2xl w-full p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] border border-white/12 text-[#FBF6E9] animate-bounce-in relative"
          >
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-5 right-5 text-white/40 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>

            <h2 className="text-xl font-black text-[#FBF6E9] mb-6">Choose Question Type</h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#FAC747] mb-3">
                  Test Knowledge
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {/* Quiz */}
                  <button
                    onClick={() => handleAddQuestion('quiz')}
                    className="p-4 rounded-2xl border border-white/10 bg-[#131938]/70 hover:border-[#FAC747] hover:bg-[#182046] hover:shadow-[0_8px_25px_-5px_rgba(250,199,71,0.25)] flex flex-col items-center text-center transition-all group cursor-pointer"
                  >
                    <QuestionTypeAnimation type="quiz" size={64} showLabel={false} />
                    <span className="font-bold text-sm text-[#FBF6E9] group-hover:text-[#FAC747] transition-colors mt-2">Quiz</span>
                    <span className="text-[11px] text-white/50 mt-0.5">2-6 answers</span>
                  </button>

                  {/* True / False */}
                  <button
                    onClick={() => handleAddQuestion('true_false')}
                    className="p-4 rounded-2xl border border-white/10 bg-[#131938]/70 hover:border-[#FAC747] hover:bg-[#182046] hover:shadow-[0_8px_25px_-5px_rgba(250,199,71,0.25)] flex flex-col items-center text-center transition-all group cursor-pointer"
                  >
                    <QuestionTypeAnimation type="true_false" size={64} showLabel={false} />
                    <span className="font-bold text-sm text-[#FBF6E9] group-hover:text-[#FAC747] transition-colors mt-2">True or false</span>
                    <span className="text-[11px] text-white/50 mt-0.5">Binary choice</span>
                  </button>

                  {/* Yes / No */}
                  <button
                    onClick={() => handleAddQuestion('yes_no')}
                    className="p-4 rounded-2xl border border-white/10 bg-[#131938]/70 hover:border-[#FAC747] hover:bg-[#182046] hover:shadow-[0_8px_25px_-5px_rgba(250,199,71,0.25)] flex flex-col items-center text-center transition-all group cursor-pointer"
                  >
                    <QuestionTypeAnimation type="yes_no" size={64} showLabel={false} />
                    <span className="font-bold text-sm text-[#FBF6E9] group-hover:text-[#FAC747] transition-colors mt-2">Yes / No</span>
                    <span className="text-[11px] text-white/50 mt-0.5">Direct opinion</span>
                  </button>

                  {/* Puzzle */}
                  <button
                    onClick={() => handleAddQuestion('puzzle')}
                    className="p-4 rounded-2xl border border-white/10 bg-[#131938]/70 hover:border-[#FAC747] hover:bg-[#182046] hover:shadow-[0_8px_25px_-5px_rgba(250,199,71,0.25)] flex flex-col items-center text-center transition-all group cursor-pointer"
                  >
                    <QuestionTypeAnimation type="puzzle" size={64} showLabel={false} />
                    <span className="font-bold text-sm text-[#FBF6E9] group-hover:text-[#FAC747] transition-colors mt-2">Puzzle</span>
                    <span className="text-[11px] text-white/50 mt-0.5">Rank items</span>
                  </button>

                  {/* Number guessing / Slider */}
                  <button
                    onClick={() => handleAddQuestion('number_guess')}
                    className="p-4 rounded-2xl border border-white/10 bg-[#131938]/70 hover:border-[#FAC747] hover:bg-[#182046] hover:shadow-[0_8px_25px_-5px_rgba(250,199,71,0.25)] flex flex-col items-center text-center transition-all group cursor-pointer"
                  >
                    <QuestionTypeAnimation type="number_guess" size={64} showLabel={false} />
                    <span className="font-bold text-sm text-[#FBF6E9] group-hover:text-[#FAC747] transition-colors mt-2">Slider / Guess</span>
                    <span className="text-[11px] text-white/50 mt-0.5">Target number</span>
                  </button>

                  {/* Word Guess / Fill in the blank */}
                  <button
                    onClick={() => handleAddQuestion('word_guess')}
                    className="p-4 rounded-2xl border border-white/10 bg-[#131938]/70 hover:border-[#FAC747] hover:bg-[#182046] hover:shadow-[0_8px_25px_-5px_rgba(250,199,71,0.25)] flex flex-col items-center text-center transition-all group cursor-pointer"
                  >
                    <QuestionTypeAnimation type="word_guess" size={64} showLabel={false} />
                    <span className="font-bold text-sm text-[#FBF6E9] group-hover:text-[#FAC747] transition-colors mt-2">Fill in Blank</span>
                    <span className="text-[11px] text-white/50 mt-0.5">Word guess cloud</span>
                  </button>

                  {/* Picture Reveal */}
                  <button
                    onClick={() => handleAddQuestion('picture_reveal')}
                    className="p-4 rounded-2xl border border-white/10 bg-[#131938]/70 hover:border-[#FAC747] hover:bg-[#182046] hover:shadow-[0_8px_25px_-5px_rgba(250,199,71,0.25)] flex flex-col items-center text-center transition-all group cursor-pointer"
                  >
                    <QuestionTypeAnimation type="picture_reveal" size={64} showLabel={false} />
                    <span className="font-bold text-sm text-[#FBF6E9] group-hover:text-[#FAC747] transition-colors mt-2">Picture Reveal</span>
                    <span className="text-[11px] text-white/50 mt-0.5">Progressive grid</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quiz Global Settings Modal */}
      <QuizSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        quiz={quiz}
        onTitleChange={(title) => setQuiz((prev) => ({ ...prev, title }))}
        onSave={handleApplyGlobalSettings}
      />

      {/* Floating Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white border-2 border-emerald-400 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-sm font-bold animate-bounce-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
};
