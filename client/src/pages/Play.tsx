import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import confetti from 'canvas-confetti';
import {
  XCircle,
  X,
  Flame,
  Trophy,
  Check,
  ChevronUp,
  ChevronDown,
  Clock,
  Sparkles,
  Lock,
  Smile,
  Pencil,
  Minus,
  Plus,
  User,
  Send,
  CheckSquare,
  CheckCircle,
  Zap,
  ZapOff,
  Loader2,
  WifiOff,
} from 'lucide-react';

import { getSocket } from '../utils/socket';
import { sound } from '../utils/audio';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { KAHOOT_COLORS, ShapeIcon } from '../components/ShapeIcon';

import { PuzzleReorder } from '../components/PuzzleReorder';
import { QuestionTypeAnimation } from '../components/QuestionTypeAnimation';
import { EmojiPickerModal } from '../components/EmojiPickerModal';
import { PlayerProfileModal } from '../components/PlayerProfileModal';
import { PictureRevealGrid } from '../components/PictureRevealGrid';
import { getDeviceUuid, initDeviceUuid, syncResilientDeviceUuid, onDeviceUuidChange } from '../utils/device';
import { checkActiveGame } from '../utils/api';

const cleanPin = (p: string) => p.trim().replace(/\s+/g, '');

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const Play: React.FC = () => {
  const { gamePinParam } = useParams<{ gamePinParam?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const socket = getSocket();

  // Resolve initial PIN from route parameter or query string:
  // e.g. /play/141201, /play/game_id=141201, /play?game_id=141201, /play?pin=141201
  const rawParamPin = (
    gamePinParam?.replace(/^(game_id=|gameId=)/i, '') ||
    searchParams.get('game_id') ||
    searchParams.get('gameId') ||
    searchParams.get('pin') ||
    ''
  ).trim();

  // Two-phase join: 'PIN' | 'NICKNAME'
  const [joinStep, setJoinStep] = useState<'PIN' | 'NICKNAME'>(rawParamPin ? 'NICKNAME' : 'PIN');
  const [pin, setPin] = useState(rawParamPin);
  const [nickname, setNickname] = useState('');
  const [userUuid, setUserUuid] = useState(() => getDeviceUuid());
  const [isDeviceReady, setIsDeviceReady] = useState(false);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [joinedPin, setJoinedPin] = useState<string | null>(null);
  const joined = Boolean(joinedPin && joinedPin === cleanPin(pin));
  const [isCheckingPin, setIsCheckingPin] = useState(false);
  const [playerInfo, setPlayerInfo] = useState<any>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<string>(
    () => localStorage.getItem('kahoot_avatar') || '🦊'
  );
  const [isEmojiModalOpen, setIsEmojiModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  useEscapeKey(() => {
    setIsEmojiModalOpen(false);
    setIsProfileModalOpen(false);
  }, isEmojiModalOpen || isProfileModalOpen);

  // Live game state
  const [gameState, setGameState] = useState<string>('JOIN');
  const [question, setQuestion] = useState<any>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionEndsAt, setQuestionEndsAt] = useState<number | undefined>(undefined);
  const [showQuestionsOnPlayerScreens, setShowQuestionsOnPlayerScreens] = useState<boolean>(true);

  // Progressive question feature reveal stage during GET_READY (1: Type, 2: Multi-select, 3: Points)
  const [getReadyStage, setGetReadyStage] = useState<number>(1);

  useEffect(() => {
    if (gameState === 'GET_READY') {
      setGetReadyStage(1);
      const t1 = setTimeout(() => {
        setGetReadyStage(2);
      }, 4000);
      const t2 = setTimeout(() => {
        setGetReadyStage(3);
      }, 5000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      setGetReadyStage(1);
    }
  }, [gameState, questionIndex]);

  // Player answer state
  const [selectedSingle, setSelectedSingle] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<string[]>([]);
  const [puzzleOrder, setPuzzleOrder] = useState<string[]>([]);
  const [guessedNumber, setGuessedNumber] = useState<number>(50);
  const [guessedNumberText, setGuessedNumberText] = useState<string>('50');
  const [typedWord, setTypedWord] = useState<string>('');
  const [typedWords, setTypedWords] = useState<string[]>([]);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const hasSubmittedRef = useRef(false);
  const lastQuestionIndexRef = useRef<number>(-1);

  const clampGuess = (val: number, minVal: number, maxVal: number) => {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    setGuessedNumber(clamped);
    setGuessedNumberText(String(clamped));
    return clamped;
  };

  const addTypedWord = () => {
    const val = typedWord.trim();
    if (val && !typedWords.includes(val)) {
      setTypedWords((prev) => [...prev, val]);
      setTypedWord('');
    }
  };

  // Feedback results
  const [feedback, setFeedback] = useState<{
    isCorrect: boolean;
    isPartial?: boolean;
    isExact?: boolean;
    pointsEarned: number;
    totalScore: number;
    streak: number;
    accuracy?: number;
    timeScore?: number;
    questionType?: string;
    isMultiSelect?: boolean;
    correctOptionIds?: string[];
    selectedOptionIds?: string[];
    options?: { id: string; text: string; isCorrect: boolean }[];
    numberTarget?: number;
    playerGuess?: number;
    userInput?: any;
    matchedAccepted?: string;
    acceptedAnswers?: string[];
  } | null>(null);

  const [standing, setStanding] = useState<any>(null);
  const [finalResult, setFinalResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [submissionError, setSubmissionError] = useState('');

  // 1. Authoritatively initialize device UUID without provisional guesses
  useEffect(() => {
    let isMounted = true;
    initDeviceUuid().then((authoritativeUuid) => {
      if (!isMounted) return;
      setUserUuid(authoritativeUuid);
      setIsDeviceReady(true);
    });

    const unsubscribe = onDeviceUuidChange((resolvedUuid) => {
      setUserUuid(resolvedUuid);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // 2. Track connection state
  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  // 3. Auto-resume from persistent userUuid or check active game once device is ready
  useEffect(() => {
    if (!isDeviceReady) return;

    const storedNickname = localStorage.getItem('kahoot_nickname') || '';

    if (storedNickname && !nickname) {
      setNickname(storedNickname);
    }

    if (rawParamPin) {
      const cleanRawPin = rawParamPin.trim().replace(/\s+/g, '');
      setPin(cleanRawPin);

      // If we haven't joined this exact pin yet, stay on NICKNAME step
      if (joinedPin !== cleanRawPin) {
        setJoinedPin(null);
        setJoinStep('NICKNAME');
        setGameState('JOIN');
      }

      // Check if device is ALREADY an active player in this exact game
      checkActiveGame().then((active) => {
        if (active.hasActiveGame && active.pin === cleanRawPin && active.player) {
          if (active.player.nickname) {
            setNickname(active.player.nickname);
          }
          if (active.player.avatar) {
            setSelectedAvatar(active.player.avatar);
          }
          // Only auto-rejoin if player was ALREADY playing this exact game pin
          socket.emit('player_join', {
            pin: cleanRawPin,
            nickname: active.player.nickname || storedNickname || nickname,
            userUuid,
            avatar: active.player.avatar || selectedAvatar,
          });
        }
      });
    } else {
      // Check if device has an ongoing active game to resume
      checkActiveGame().then((active) => {
        if (active.hasActiveGame && active.pin && active.player) {
          setPin(active.pin);
          if (active.player.nickname) {
            setNickname(active.player.nickname);
          }
          if (active.player.avatar) {
            setSelectedAvatar(active.player.avatar);
          }
          socket.emit('player_join', {
            pin: active.pin,
            nickname: active.player.nickname || storedNickname || nickname,
            userUuid,
            avatar: active.player.avatar || selectedAvatar,
          });
        } else {
          localStorage.removeItem('kahoot_pin');
          setPin('');
          setJoinedPin(null);
          setJoinStep('PIN');
          setGameState('JOIN');
        }
      });
    }
  }, [isDeviceReady, rawParamPin, socket, userUuid]);

  // Re-emit player_join and sync request if socket disconnects and reconnects during active game
  useEffect(() => {
    const handleSocketConnect = () => {
      setIsConnected(true);
      const activeUuid = userUuid || getDeviceUuid();
      const cleanPinStr = pin.trim().replace(/\s+/g, '');
      if (joinedPin && joinedPin === cleanPinStr && nickname) {
        socket.emit('player_join', {
          pin: cleanPinStr,
          nickname,
          userUuid: activeUuid,
          avatar: selectedAvatar,
        });
        socket.emit('player_request_sync', {
          pin: cleanPinStr,
          userUuid: activeUuid,
        });
      }
    };

    socket.on('connect', handleSocketConnect);
    return () => {
      socket.off('connect', handleSocketConnect);
    };
  }, [joinedPin, pin, nickname, selectedAvatar, socket, userUuid]);

  // Socket listener setup
  useEffect(() => {
    socket.on('join_success', (data) => {
      setJoinedPin(data.pin);
      const activeUuid = data.userUuid || getDeviceUuid();
      setUserUuid(activeUuid);
      setPlayerInfo(data.player);
      if (data.player?.avatar) {
        setSelectedAvatar(data.player.avatar);
        localStorage.setItem('kahoot_avatar', data.player.avatar);
      }
      if (data.player?.nickname) {
        setNickname(data.player.nickname);
        localStorage.setItem('kahoot_nickname', data.player.nickname);
      }
      setErrorMsg('');

      if (data.settings?.showQuestionsOnPlayerScreens !== undefined) {
        setShowQuestionsOnPlayerScreens(Boolean(data.settings.showQuestionsOnPlayerScreens));
      }

      // Persist in localStorage for reconnection resilience
      localStorage.setItem('kahoot_pin', data.pin);

      // Keep URL clean
      setSearchParams({
        pin: data.pin,
      });

      if (data.gameState) {
        setGameState(data.gameState === 'PODIUM' ? 'FINAL' : data.gameState);
      }
    });

    socket.on('player_avatar_updated', (data) => {
      if (data?.avatar) {
        setSelectedAvatar(data.avatar);
        setPlayerInfo((prev: any) => (prev ? { ...prev, avatar: data.avatar } : null));
        localStorage.setItem('kahoot_avatar', data.avatar);
      }
    });

    socket.on('settings_updated', (settings) => {
      if (settings?.showQuestionsOnPlayerScreens !== undefined) {
        setShowQuestionsOnPlayerScreens(Boolean(settings.showQuestionsOnPlayerScreens));
      }
    });

    socket.on('join_error', (data) => {
      setErrorMsg(data.error || 'Failed to join game');
    });

    socket.on('player_kicked', (data) => {
      alert(data.reason || 'You were removed from the game');
      localStorage.removeItem('kahoot_pin');
      setJoinedPin(null);
      setPin('');
      setJoinStep('PIN');
      setGameState('JOIN');
    });

    socket.on('game_state_changed', (data) => {
      setSubmissionError('');
      if (data.settings?.showQuestionsOnPlayerScreens !== undefined) {
        setShowQuestionsOnPlayerScreens(Boolean(data.settings.showQuestionsOnPlayerScreens));
      }
      if (data.state === 'GET_READY') {
        setGameState('GET_READY');
        setQuestionIndex(data.questionIndex);
        lastQuestionIndexRef.current = data.questionIndex;
        setQuestion(data.questionInfo);
        setQuestionEndsAt(undefined);
        hasSubmittedRef.current = false;
        setHasSubmitted(false);
        setFeedback(null);
        setSelectedSingle(null);
        setSelectedMulti([]);
      } else if (data.state === 'QUESTION_REVEAL') {
        setGameState('QUESTION_REVEAL');
      }
    });

    socket.on('question_active', (data) => {
      setSubmissionError('');
      if (!data || !data.question || !data.question.id) {
        console.warn('Received invalid question_active payload, requesting sync...');
        const activeUuid = userUuid || getDeviceUuid();
        socket.emit('player_request_sync', { pin: cleanPin(pin), userUuid: activeUuid });
        return;
      }
      if (
        (data.question.type === 'quiz' || data.question.type === 'true_false' || data.question.type === 'yes_no') &&
        (!Array.isArray(data.question.options) || data.question.options.length === 0)
      ) {
        console.warn('Missing options for question in question_active, requesting sync...');
        const activeUuid = userUuid || getDeviceUuid();
        socket.emit('player_request_sync', { pin: cleanPin(pin), userUuid: activeUuid });
        return;
      }

      if (data.settings?.showQuestionsOnPlayerScreens !== undefined) {
        setShowQuestionsOnPlayerScreens(Boolean(data.settings.showQuestionsOnPlayerScreens));
      }
      setGameState('QUESTION_ACTIVE');
      setQuestion(data.question);
      setQuestionIndex(data.questionIndex);
      const timeLimitSec = data.question?.timeLimit || 20;
      const endsAt = data.endsAt || (data.questionStartTime ? data.questionStartTime + timeLimitSec * 1000 : undefined);
      setQuestionEndsAt(endsAt);

      const isNewQuestion = lastQuestionIndexRef.current !== data.questionIndex;
      lastQuestionIndexRef.current = data.questionIndex;

      if (isNewQuestion) {
        const isAnswered = Boolean(data.alreadyAnswered);
        hasSubmittedRef.current = isAnswered;
        setHasSubmitted(isAnswered);
        setFeedback(null);
        setSelectedSingle(null);
        setSelectedMulti([]);
        setTypedWord('');
        setTypedWords([]);
      } else {
        // Same question index: retain submitted status
        if (data.alreadyAnswered || hasSubmittedRef.current) {
          hasSubmittedRef.current = true;
          setHasSubmitted(true);
        }
      }

      if (data.question?.type === 'puzzle') {
        setPuzzleOrder((data.question.options || []).map((o: any) => o.id));
      } else if (data.question?.type === 'number_guess') {
        const initialVal = Math.round(
          ((data.question.numberMin ?? 0) + (data.question.numberMax ?? 100)) / 2
        );
        setGuessedNumber(initialVal);
        setGuessedNumberText(String(initialVal));
      }
    });

    socket.on('answer_submitted_ack', (data) => {
      if (data && !data.success) {
        if (!data.duplicate) {
          hasSubmittedRef.current = false;
          setHasSubmitted(false);
          setSubmissionError(data.error || 'Submission was rejected by server. Please try again.');
        }
      } else {
        setSubmissionError('');
      }
    });

    socket.on('player_feedback', (data) => {
      setQuestionEndsAt(undefined);
      if (!data) {
        console.warn('Received empty feedback payload, requesting sync...');
        const activeUuid = userUuid || getDeviceUuid();
        socket.emit('player_request_sync', { pin: cleanPin(pin), userUuid: activeUuid });
        return;
      }
      setGameState('FEEDBACK');
      setFeedback(data);
      if (data?.options && data.options.length > 0) {
        setQuestion({
          id: data.questionId,
          type: data.questionType,
          options: data.options,
        });
      }
      if (data.isCorrect) {
        sound.playCorrect();
      } else {
        sound.playWrong();
      }
    });

    socket.on('player_standing', (data) => {
      setGameState('STANDING');
      setStanding(data);
    });

    socket.on('final_results', (data) => {
      setGameState('FINAL');
      setFinalResult(data);
      if (data.isPodium) {
        confetti({ particleCount: 100, spread: 80 });
      }
    });

    return () => {
      socket.off('join_success');
      socket.off('join_error');
      socket.off('player_kicked');
      socket.off('game_state_changed');
      socket.off('question_active');
      socket.off('answer_submitted_ack');
      socket.off('player_feedback');
      socket.off('player_standing');
      socket.off('final_results');
      socket.off('player_avatar_updated');
      socket.off('settings_updated');
    };
  }, [socket]);

  // Phase 1: PIN Submission & Verification
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanPin(pin);
    if (!clean) {
      setErrorMsg('Please enter a Game PIN');
      return;
    }

    setIsCheckingPin(true);
    setErrorMsg('');

    try {
      const res = await fetch(`/api/games/${encodeURIComponent(clean)}/status`);
      const data = await res.json();
      if (!res.ok || !data.exists) {
        setErrorMsg(data.error || 'Game not found with this PIN');
        setIsCheckingPin(false);
        return;
      }

      const verifiedPin = data.pin || clean;
      setPin(verifiedPin);

      // Check if this device is already in that active game
      const activeUuid = userUuid || getDeviceUuid();
      const active = await checkActiveGame();

      if (data.locked || data.isLocked) {
        if (!active.hasActiveGame || active.pin !== verifiedPin) {
          setErrorMsg('This game is locked by the host to new players.');
          setIsCheckingPin(false);
          return;
        }
      }

      if (active.hasActiveGame && active.pin === verifiedPin) {
        // Auto rejoin existing player session
        socket.emit('player_join', {
          pin: verifiedPin,
          nickname: active.player?.nickname || nickname,
          userUuid: activeUuid,
          avatar: active.player?.avatar || selectedAvatar,
        });
      } else {
        setJoinStep('NICKNAME');
        setSearchParams({ pin: verifiedPin });
      }
    } catch (err) {
      // Fallback: proceed to nickname even if offline
      setJoinStep('NICKNAME');
    } finally {
      setIsCheckingPin(false);
    }
  };

  // Handle custom avatar selection
  const handleSelectAvatar = (newEmoji: string) => {
    setSelectedAvatar(newEmoji);
    localStorage.setItem('kahoot_avatar', newEmoji);
    if (joined) {
      const activeUuid = userUuid || getDeviceUuid();
      setPlayerInfo((prev: any) => (prev ? { ...prev, avatar: newEmoji } : null));
      socket.emit('player_update_avatar', {
        pin: cleanPin(pin),
        userUuid: activeUuid,
        avatar: newEmoji,
      });
    }
  };

  // Phase 2: Nickname Submission
  const handleNicknameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = nickname.trim();
    if (!cleanName) {
      setErrorMsg('Please enter a Nickname');
      return;
    }

    const activeUuid = userUuid || getDeviceUuid();
    setUserUuid(activeUuid);

    socket.emit('player_join', {
      pin: cleanPin(pin),
      nickname: cleanName,
      userUuid: activeUuid,
      avatar: selectedAvatar,
    });
    localStorage.setItem('kahoot_avatar', selectedAvatar);
    localStorage.setItem('kahoot_nickname', cleanName);
  };

  // Submit Answer
  const submitAnswer = (answerPayload: any) => {
    if (hasSubmittedRef.current || hasSubmitted) return;
    hasSubmittedRef.current = true;
    setHasSubmitted(true);
    setSubmissionError('');

    const confirmedUserUuid = userUuid || playerInfo?.userUuid || getDeviceUuid();
    socket.emit('player_submit_answer', {
      pin: cleanPin(pin),
      userUuid: confirmedUserUuid,
      answerPayload,
    });
  };

  // Single select option tap
  const handleSelectOption = (optId: string) => {
    if (question?.isMultiSelect) {
      // Multi-select toggle
      setSelectedMulti((prev) =>
        prev.includes(optId) ? prev.filter((id) => id !== optId) : [...prev, optId]
      );
    } else {
      // Single select tap immediately submits!
      setSelectedSingle(optId);
      submitAnswer({ selected: [optId] });
    }
  };

  // Move puzzle item up/down
  const movePuzzleItem = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= puzzleOrder.length) return;
    const newOrder = [...puzzleOrder];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    setPuzzleOrder(newOrder);
  };

  if (!isDeviceReady) {
    return (
      <div className="fixed inset-0 w-full h-[100dvh] flex flex-col items-center justify-center bg-[#080A1F] text-[#FBF6E9] p-6 text-center select-none">
        <Loader2 className="w-10 h-10 animate-spin text-[#FAC747] mb-3" />
        <p className="text-sm font-bold tracking-wide text-white/80">Initializing player session...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-full h-[100dvh] max-h-[100dvh] flex flex-col justify-between bg-[#080A1F] text-[#FBF6E9] select-none overflow-y-auto touch-pan-y font-sans overscroll-y-contain">
      {/* Disconnect Overlay: Player never interacts with active game while disconnected */}
      {joined && !isConnected && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fade-in">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/20 text-[#FAC747] flex items-center justify-center mb-4 border border-[#FAC747]/30 shadow-2xl">
            <WifiOff className="w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-[#FBF6E9] mb-2">Connection Lost</h2>
          <p className="text-sm text-white/70 max-w-sm mb-6 font-medium">
            Attempting to reconnect to the game server. Your position and score will be restored as soon as connection is re-established.
          </p>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-xs font-bold text-[#FAC747]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Reconnecting...</span>
          </div>
        </div>
      )}

      {/* Profile Button in corner */}
      <button
        onClick={() => setIsProfileModalOpen(true)}
        className="fixed top-3 left-3 sm:top-4 sm:left-4 z-50 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/5 hover:bg-white/10 text-[#FBF6E9] backdrop-blur-xl border border-white/10 shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-2"
        title="My Career Stats & Profile"
      >
        <span className="text-sm">{selectedAvatar || '👤'}</span>
        <span className="text-xs font-black truncate max-w-[85px] sm:max-w-[130px]">
          {nickname || 'Profile'}
        </span>
      </button>

      {/* Admin Login Button in corner */}
      <button
        onClick={() => navigate('/admin/login')}
        className="fixed top-3 right-3 sm:top-4 sm:right-4 z-50 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/5 hover:bg-white/10 text-[#FAC747] backdrop-blur-xl border border-[#FAC747]/30 shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
        title="Admin Login"
      >
        <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FAC747]" />
        <span className="text-xs font-black hidden sm:inline">Admin</span>
      </button>

      {/* ========================================================================= */}
      {/* 1. JOIN SCREEN (TWO-PHASE: PIN -> NICKNAME) */}
      {/* ========================================================================= */}
      {(!joined || gameState === 'JOIN') && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-6 cosmic-canvas relative overflow-hidden touch-pan-y">
          {/* Subtle ambient glowing orbs */}
          <div className="absolute w-96 h-96 rounded-full bg-indigo-600/15 blur-[120px] pointer-events-none -top-20 -left-20 animate-pulse" />
          <div className="absolute w-96 h-96 rounded-full bg-amber-500/10 blur-[120px] pointer-events-none -bottom-20 -right-20" />

          <div className="w-full max-w-sm cosmic-surface rounded-3xl p-6 sm:p-8 text-[#FBF6E9] animate-bounce-in relative z-10 border border-white/12 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]">
            <div className="text-center mb-5 sm:mb-7 flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FAC747] to-[#DB941F] text-[#2A1A00] flex items-center justify-center font-black text-2xl shadow-xl shadow-amber-500/25 mb-3 group-hover:scale-105 transition-transform">
                BQ
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-[#FBF6E9] tracking-tight">
                BetelQuiz
              </h1>
              <p className="text-xs text-[#FAC747] mt-1.5 font-bold uppercase tracking-widest">
                {joinStep === 'PIN' ? 'Enter Game PIN' : 'Pick a Nickname'}
              </p>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 bg-red-500/15 border border-red-500/30 text-red-200 rounded-2xl text-xs font-bold text-center">
                {errorMsg}
              </div>
            )}

            {/* PHASE 1: ENTER PIN */}
            {joinStep === 'PIN' && (
              <form onSubmit={handlePinSubmit} className="space-y-4">
                <div>
                  <input
                    type="text"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      setErrorMsg('');
                    }}
                    placeholder="Game PIN"
                    maxLength={10}
                    autoFocus
                    className="cosmic-input w-full text-center text-3xl font-black font-mono tracking-widest py-4 px-4 rounded-2xl placeholder:font-normal placeholder:tracking-normal placeholder:text-white/30"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isCheckingPin || !isConnected}
                  className="btn-gold w-full py-4 rounded-2xl text-base sm:text-lg font-black shadow-lg shadow-amber-500/25 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isCheckingPin ? 'Connecting...' : !isConnected ? 'Connecting to server...' : 'Enter'}
                </button>
              </form>
            )}

            {/* PHASE 2: PICK NICKNAME */}
            {joinStep === 'NICKNAME' && (
              <form onSubmit={handleNicknameSubmit} className="space-y-4">
                {/* Current PIN Pill with option to change */}
                <div className="flex items-center justify-between bg-white/5 px-4 py-2 rounded-xl border border-white/10 text-xs">
                  <span className="font-bold text-white/70">
                    PIN: <span className="font-mono font-black text-[#FAC747] text-sm">{pin}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setJoinStep('PIN');
                      setErrorMsg('');
                    }}
                    className="text-[#5CC7B8] font-bold hover:underline cursor-pointer"
                  >
                    Change PIN
                  </button>
                </div>

                {/* Avatar Preview & Customization Button */}
                <div className="flex flex-col items-center justify-center pt-1 pb-1">
                  <button
                    type="button"
                    onClick={() => setIsEmojiModalOpen(true)}
                    className="relative group cursor-pointer focus:outline-none"
                    title="Tap to customize your emoji"
                  >
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-tr from-[#1F2A6A] via-[#161D48] to-[#0F1433] border-4 border-[#FAC747]/70 shadow-[0_0_25px_rgba(250,199,71,0.3)] flex items-center justify-center text-4xl sm:text-5xl group-hover:scale-105 active:scale-95 transition-all">
                      {selectedAvatar}
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#FAC747] text-[#2A1A00] flex items-center justify-center shadow-lg border-2 border-[#0F1433]">
                      <Pencil className="w-3.5 h-3.5 stroke-[2.5]" />
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEmojiModalOpen(true)}
                    className="mt-2.5 text-xs font-bold text-[#FAC747] hover:underline flex items-center gap-1.5 cursor-pointer"
                  >
                    <Smile className="w-3.5 h-3.5" />
                    <span>Choose Avatar Emoji</span>
                  </button>
                </div>

                <div>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => {
                      setNickname(e.target.value);
                      setErrorMsg('');
                    }}
                    placeholder="Nickname"
                    maxLength={18}
                    autoFocus
                    className="cosmic-input w-full text-center text-2xl font-black py-3.5 px-4 rounded-2xl placeholder:font-normal placeholder:text-white/30"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!isConnected}
                  className="btn-gold w-full py-4 rounded-2xl text-lg font-black shadow-lg shadow-amber-500/25 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {!isConnected ? 'Connecting...' : 'OK, go!'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. LOBBY WAITING SCREEN */}
      {/* ========================================================================= */}
      {joined && gameState === 'LOBBY' && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 cosmic-canvas text-center overflow-hidden relative">
          <div className="absolute w-96 h-96 rounded-full bg-emerald-600/10 blur-[130px] pointer-events-none -top-20" />
          <div className="animate-bounce-in flex flex-col items-center relative z-10 max-w-sm w-full">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 flex items-center justify-center mb-4 sm:mb-6 shadow-[0_0_30px_rgba(92,199,184,0.4)]">
              <Check className="w-12 h-12 sm:w-14 sm:h-14 stroke-[3]" />
            </div>

            <h1 className="text-3xl sm:text-4xl font-black mb-2 text-[#FBF6E9] tracking-tight">
              You're in!
            </h1>
            <p className="text-[#FBF6E9]/70 text-sm sm:text-base max-w-xs mb-6 font-medium">
              See your nickname on the host screen!
            </p>

            <div className="cosmic-hero-card w-full p-6 rounded-3xl flex flex-col items-center gap-3 shadow-2xl">
              <button
                type="button"
                onClick={() => setIsEmojiModalOpen(true)}
                className="relative group cursor-pointer focus:outline-none"
                title="Tap to change your avatar emoji"
              >
                <div className="w-18 h-18 rounded-full bg-white/10 border-2 border-[#FAC747]/60 flex items-center justify-center text-4xl shadow-md group-hover:scale-110 active:scale-95 transition-all">
                  {playerInfo?.avatar || selectedAvatar}
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#FAC747] text-[#2A1A00] flex items-center justify-center shadow-md border border-[#0F1433]">
                  <Pencil className="w-3 h-3 stroke-[2.5]" />
                </div>
              </button>
              <span className="text-2xl sm:text-3xl font-black text-[#FBF6E9]">
                {playerInfo?.nickname}
              </span>
              <button
                type="button"
                onClick={() => setIsEmojiModalOpen(true)}
                className="text-xs font-bold text-[#FAC747] bg-amber-400/10 hover:bg-amber-400/20 px-3.5 py-1.5 rounded-full border border-[#FAC747]/25 flex items-center gap-1.5 transition-all cursor-pointer mt-0.5"
              >
                <Smile className="w-3.5 h-3.5" />
                <span>Change Avatar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. GET READY SCREEN */}
      {/* ========================================================================= */}
      {joined && gameState === 'GET_READY' && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 cosmic-canvas text-center animate-bounce-in overflow-hidden relative">
          {/* Step 1: Animated Question Type */}
          <div className="mb-4">
            <QuestionTypeAnimation type={question?.type || 'quiz'} size={110} />
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-[#FAC747] mb-2 px-3 py-1 rounded-full bg-amber-400/10 border border-[#FAC747]/20">
            Question {questionIndex + 1}
          </span>
          <h2 className="text-3xl sm:text-5xl font-black mb-3 text-[#FBF6E9] tracking-tight">
            Get Ready!
          </h2>
          {question?.title && (
            <p className="text-sm sm:text-base font-bold text-[#FBF6E9] max-w-sm px-5 py-3 cosmic-surface rounded-2xl border border-white/15 shadow-lg">
              {question.title}
            </p>
          )}

          {/* Progressive Feature Reveal (Kahoot-style step 2 & step 3) */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4 min-h-[46px]">
            {/* Step 2: Selection Mode Badge (Stage 2: 4s mark, quiz types only) */}
            {getReadyStage >= 2 && ['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(question?.type || 'quiz') && (
              Boolean(question?.isMultiSelect) ? (
                <div className="animate-pop-badge flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5CC7B8]/20 border border-[#5CC7B8] text-[#5CC7B8] shadow-[0_0_15px_rgba(92,199,184,0.3)] backdrop-blur-md">
                  <CheckSquare className="w-4 h-4 stroke-[2.5]" />
                  <span className="font-black text-xs uppercase tracking-wider">Multi-Select</span>
                </div>
              ) : (
                <div className="animate-pop-badge flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/15 border border-sky-400 text-sky-300 shadow-[0_0_15px_rgba(56,189,248,0.2)] backdrop-blur-md">
                  <CheckCircle className="w-4 h-4 stroke-[2.5]" />
                  <span className="font-black text-xs uppercase tracking-wider">Single Select</span>
                </div>
              )
            )}

            {/* Step 3: Points Badge (Stage 3: 5s mark, only if not standard 1000 points) */}
            {getReadyStage >= 3 && (() => {
              const pts = question?.points ?? 1000;
              if (pts === 1000) return null;
              const multiplier = pts / 1000;

              const multiplierStr =
                pts === 0
                  ? '0 Points'
                  : `x${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)} Points`;

              return (
                <div className="animate-pop-badge flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400/20 border border-[#FAC747] text-[#FAC747] shadow-[0_0_15px_rgba(250,199,71,0.35)] backdrop-blur-md">
                  {pts === 0 ? (
                    <ZapOff className="w-4 h-4 stroke-[2.5]" />
                  ) : (
                    <Zap className="w-4 h-4 stroke-[2.5] fill-current animate-pulse" />
                  )}
                  <span className="font-black text-xs uppercase tracking-wider">{multiplierStr}</span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. ACTIVE QUESTION SCREEN */}
      {/* ========================================================================= */}
      {joined && gameState === 'QUESTION_ACTIVE' && question && (
        <div className="flex-1 min-h-0 flex flex-col justify-between p-2 sm:p-4 bg-slate-900 overflow-y-auto touch-pan-y select-none">
          {/* Top Info Bar */}
          <div className="flex items-center justify-between pb-1.5 sm:pb-2.5 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white text-slate-900 font-black text-xs flex items-center justify-center">
                {questionIndex + 1}
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-white/70">
                {question.type.replace('_', ' ')}
              </span>
            </div>

            <div className="text-[11px] sm:text-xs font-black text-white/90 bg-white/10 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full">
              {question.isMultiSelect
                ? 'Select one or more answers!'
                : question.type === 'puzzle'
                ? 'Drag to arrange in correct order'
                : question.type === 'number_guess'
                ? 'Guess target number'
                : 'Tap to answer'}
            </div>
          </div>

          {/* Submission error notice if server rejected answer */}
          {submissionError && (
            <div className="shrink-0 my-1.5 p-2.5 bg-red-600/90 text-white rounded-xl text-xs font-bold text-center border border-red-400 animate-bounce-in shadow-lg">
              {submissionError}
            </div>
          )}

          {/* Question Title & Media (when Host enabled "Show questions & answers on devices") */}
          {showQuestionsOnPlayerScreens && question.title && (
            <div className="shrink-0 my-1 sm:my-2 px-3 py-1.5 sm:py-2.5 rounded-xl bg-white/10 backdrop-blur border border-white/15 text-center flex flex-col items-center justify-center shadow-md">
              <h2 className="text-xs sm:text-sm md:text-base font-extrabold text-white line-clamp-3 leading-snug drop-shadow">
                {question.title}
              </h2>
              {question.type === 'picture_reveal' && question.image && (
                <PictureRevealGrid
                  imageUrl={question.image}
                  tileLevel={question.tileLevel || 'medium'}
                  durationSeconds={question.timeLimit || 20}
                  endsAt={questionEndsAt}
                  className="max-h-[16vh] sm:max-h-[20vh] mt-2"
                />
              )}
            </div>
          )}

          {/* If already submitted, show Waiting for others state */}
          {hasSubmitted ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center p-4 sm:p-6 animate-bounce-in">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/15 backdrop-blur flex items-center justify-center mb-3 sm:mb-4 animate-pulse">
                <Check className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-400 stroke-[3]" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black mb-1">Answer submitted!</h2>
              <p className="text-xs sm:text-sm text-white/60">Waiting for other players...</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col justify-between py-1 sm:py-2 overflow-y-auto touch-pan-y">
              {/* Type 1: Quiz, True/False, Yes/No, Picture Reveal */}
              {(question.type === 'quiz' ||
                question.type === 'true_false' ||
                question.type === 'yes_no' ||
                question.type === 'picture_reveal') && (
                <div className="flex-1 min-h-0 flex flex-col justify-between">
                  {/* Grid of Big Colorful Touch Tiles - Proportional Responsive Sizing */}
                  <div
                    className={`flex-1 min-h-0 grid gap-2 sm:gap-3 my-1 sm:my-2 auto-rows-fr ${
                      (question.options || []).length <= 2
                        ? 'grid-cols-1 grid-rows-2'
                        : (question.options || []).length <= 4
                        ? 'grid-cols-2 grid-rows-2'
                        : 'grid-cols-2 grid-rows-3'
                    }`}
                  >
                    {(question.options || []).map((opt: any, idx: number) => {
                      const itemIdx = opt.colorIndex ?? idx;
                      const color = KAHOOT_COLORS[itemIdx % KAHOOT_COLORS.length];
                      const isSelected = question.isMultiSelect
                        ? selectedMulti.includes(opt.id)
                        : selectedSingle === opt.id;

                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSelectOption(opt.id)}
                          className={`${color.bg} rounded-xl sm:rounded-2xl flex flex-col items-center justify-center p-1.5 sm:p-2.5 relative transition-all active:scale-95 shadow-lg h-full w-full min-h-0 overflow-hidden cursor-pointer touch-manipulation select-none ${
                            isSelected ? 'ring-4 ring-white scale-98' : ''
                          }`}
                        >
                          {/* Corner Toggle Check Circle for Multi-Select */}
                          {question.isMultiSelect && (
                            <div className="absolute top-2 right-2 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-white/30 flex items-center justify-center border-2 border-white">
                              {isSelected && (
                                <div className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full bg-white flex items-center justify-center">
                                  <Check className="w-2.5 h-2.5 text-slate-900 stroke-[4]" />
                                </div>
                              )}
                            </div>
                          )}

                          {showQuestionsOnPlayerScreens ? (
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2.5 w-full px-2 text-center sm:text-left min-h-0 pointer-events-none">
                              <ShapeIcon
                                index={itemIdx}
                                size={(question.options || []).length > 4 ? 20 : 26}
                                className="text-white drop-shadow-md shrink-0"
                              />
                              <span className="text-white font-extrabold text-xs sm:text-sm md:text-base line-clamp-2 leading-tight drop-shadow">
                                {opt.text}
                              </span>
                            </div>
                          ) : (
                            <ShapeIcon
                              index={itemIdx}
                              size={(question.options || []).length > 4 ? 30 : 44}
                              className="text-white drop-shadow-md pointer-events-none"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Multi-Select Submit Button */}
                  {question.isMultiSelect && (
                    <div className="pt-2 sm:pt-3 shrink-0">
                      <button
                        onClick={() => submitAnswer({ selected: selectedMulti })}
                        disabled={selectedMulti.length === 0}
                        className="btn-gold w-full py-3.5 sm:py-4 rounded-2xl text-base sm:text-lg font-black shadow-xl active:scale-95 disabled:opacity-40 disabled:active:scale-100 transition-all cursor-pointer"
                      >
                        Submit Answer
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Type 2: Puzzle (Ranking / Ordering items with Drag & Drop!) */}
              {question.type === 'puzzle' && (
                <div className="flex-1 min-h-0 flex flex-col justify-between py-1">
                  <div className="flex-1 min-h-0 flex flex-col justify-center my-auto">
                    <PuzzleReorder
                      options={question.options || []}
                      order={puzzleOrder}
                      onChangeOrder={setPuzzleOrder}
                    />
                  </div>

                  <button
                    onClick={() => submitAnswer({ order: puzzleOrder })}
                    className="btn-gold w-full py-3.5 sm:py-4 rounded-2xl text-base sm:text-lg font-black shadow-xl active:scale-95 transition-all mt-3 cursor-pointer shrink-0"
                  >
                    Submit Order
                  </button>
                </div>
              )}

              {/* Type 3: Number Guessing */}
              {question.type === 'number_guess' && (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-2 px-4 max-w-sm mx-auto w-full">
                  {/* Stepper & Clickable / Editable Number Input */}
                  <div className="flex items-center justify-center gap-2 sm:gap-3 w-full mb-3">
                    {/* Minus button */}
                    <button
                      type="button"
                      onClick={() => {
                        const minVal = question.numberMin ?? 0;
                        const maxVal = question.numberMax ?? 100;
                        const parsed = Number(guessedNumberText);
                        const cur = !isNaN(parsed) && guessedNumberText.trim() !== '' ? parsed : guessedNumber;
                        clampGuess(cur - 1, minVal, maxVal);
                      }}
                      disabled={
                        (!isNaN(Number(guessedNumberText)) && guessedNumberText.trim() !== ''
                          ? Number(guessedNumberText)
                          : guessedNumber) <= (question.numberMin ?? 0)
                      }
                      className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/15 hover:bg-white/25 active:scale-95 disabled:opacity-30 disabled:active:scale-100 text-white font-black flex items-center justify-center shadow-lg border border-white/20 transition-all cursor-pointer shrink-0"
                      title="Decrease by 1"
                    >
                      <Minus className="w-6 h-6 stroke-[3]" />
                    </button>

                    {/* Number Box: Tap to Type / Edit */}
                    <div className="relative flex-1 group">
                      <input
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={question.numberMin ?? 0}
                        max={question.numberMax ?? 100}
                        value={guessedNumberText}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGuessedNumberText(val);
                          const parsed = Number(val);
                          if (!isNaN(parsed) && val.trim() !== '') {
                            const minVal = question.numberMin ?? 0;
                            const maxVal = question.numberMax ?? 100;
                            setGuessedNumber(Math.max(minVal, Math.min(maxVal, parsed)));
                          }
                        }}
                        onBlur={() => {
                          const minVal = question.numberMin ?? 0;
                          const maxVal = question.numberMax ?? 100;
                          let parsed = Number(guessedNumberText);
                          if (isNaN(parsed) || guessedNumberText.trim() === '') {
                            parsed = guessedNumber;
                          }
                          clampGuess(parsed, minVal, maxVal);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-full text-center text-3xl sm:text-4xl md:text-5xl font-black text-amber-300 font-mono bg-white/15 hover:bg-white/20 focus:bg-white/25 border-2 border-amber-400/60 focus:border-amber-400 rounded-2xl py-2 sm:py-2.5 px-3 shadow-inner focus:outline-none focus:ring-4 focus:ring-amber-400/30 transition-all cursor-text"
                        title="Tap to type number directly"
                      />
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity">
                        <Pencil className="w-3.5 h-3.5 text-amber-300" />
                      </div>
                    </div>

                    {/* Plus button */}
                    <button
                      type="button"
                      onClick={() => {
                        const minVal = question.numberMin ?? 0;
                        const maxVal = question.numberMax ?? 100;
                        const parsed = Number(guessedNumberText);
                        const cur = !isNaN(parsed) && guessedNumberText.trim() !== '' ? parsed : guessedNumber;
                        clampGuess(cur + 1, minVal, maxVal);
                      }}
                      disabled={
                        (!isNaN(Number(guessedNumberText)) && guessedNumberText.trim() !== ''
                          ? Number(guessedNumberText)
                          : guessedNumber) >= (question.numberMax ?? 100)
                      }
                      className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/15 hover:bg-white/25 active:scale-95 disabled:opacity-30 disabled:active:scale-100 text-white font-black flex items-center justify-center shadow-lg border border-white/20 transition-all cursor-pointer shrink-0"
                      title="Increase by 1"
                    >
                      <Plus className="w-6 h-6 stroke-[3]" />
                    </button>
                  </div>

                  {/* Range Boundaries & Slider */}
                  <div className="w-full flex items-center justify-between text-xs font-bold text-white/60 mb-1.5 px-1">
                    <span>Min: {question.numberMin ?? 0}</span>
                    <span>Max: {question.numberMax ?? 100}</span>
                  </div>

                  <input
                    type="range"
                    min={question.numberMin ?? 0}
                    max={question.numberMax ?? 100}
                    value={guessedNumber}
                    onChange={(e) => {
                      clampGuess(Number(e.target.value), question.numberMin ?? 0, question.numberMax ?? 100);
                    }}
                    className="w-full accent-amber-400 h-3.5 bg-white/20 rounded-lg cursor-pointer mb-2"
                  />

                  <p className="text-[11px] text-white/50 font-bold mb-3 sm:mb-4 text-center flex items-center gap-1 justify-center">
                    <Pencil className="w-3 h-3 text-amber-300/80" />
                    <span>Tap number to type, or drag slider</span>
                  </p>

                  <button
                    onClick={() => {
                      const minVal = question.numberMin ?? 0;
                      const maxVal = question.numberMax ?? 100;
                      let parsed = Number(guessedNumberText);
                      if (isNaN(parsed) || guessedNumberText.trim() === '') {
                        parsed = guessedNumber;
                      }
                      const clamped = clampGuess(parsed, minVal, maxVal);
                      submitAnswer({ number: clamped });
                    }}
                    className="btn-gold w-full py-3.5 sm:py-4 rounded-2xl text-base sm:text-lg font-black shadow-xl active:scale-95 transition-all cursor-pointer shrink-0"
                  >
                    Submit Guess
                  </button>
                </div>
              )}

              {/* Type 4: Word Guess / Fill in the Blank */}
              {question.type === 'word_guess' && (
                <div className="flex-1 min-h-0 flex flex-col justify-center max-w-md mx-auto w-full p-4 space-y-4">
                  {question.allowMultipleAnswers ? (
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-[#FBF6E9]/70 text-center uppercase tracking-wider">
                        Enter multiple answers (press enter or add)
                      </p>

                      {/* Typed Words Chips */}
                      <div className="flex flex-wrap gap-2 p-3 bg-white/5 rounded-2xl min-h-[50px] border border-white/10 items-center">
                        {typedWords.map((word, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-400/20 text-[#FAC747] border border-[#FAC747]/30 font-bold text-xs rounded-xl shadow"
                          >
                            <span>{word}</span>
                            <button
                              type="button"
                              onClick={() => setTypedWords((prev) => prev.filter((_, idx) => idx !== i))}
                              className="text-white/70 hover:text-white"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ))}
                        {typedWords.length === 0 && (
                          <span className="text-xs text-white/40 italic">Type a word below and press Add</span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={typedWord}
                          onChange={(e) => setTypedWord(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addTypedWord();
                            }
                          }}
                          placeholder="Type an answer..."
                          className="cosmic-input flex-1 p-3.5 rounded-2xl text-[#FBF6E9] font-bold placeholder:text-white/30"
                        />
                        <button
                          type="button"
                          onClick={addTypedWord}
                          className="btn-teal px-5 py-3.5 font-black text-sm rounded-2xl shadow transition"
                        >
                          Add
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          let finalWords = [...typedWords];
                          if (typedWord.trim() && !finalWords.includes(typedWord.trim())) {
                            finalWords.push(typedWord.trim());
                          }
                          submitAnswer({ answers: finalWords });
                        }}
                        disabled={typedWords.length === 0 && !typedWord.trim()}
                        className="btn-gold w-full py-4 rounded-2xl font-black text-base shadow-xl active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
                      >
                        Submit Answers ({typedWords.length + (typedWord.trim() ? 1 : 0)})
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-[#FBF6E9]/60 mb-2 text-center">
                          Type Your Answer:
                        </label>
                        <input
                          type="text"
                          autoFocus
                          value={typedWord}
                          onChange={(e) => setTypedWord(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (typedWord.trim()) {
                                submitAnswer({ text: typedWord.trim() });
                              }
                            }
                          }}
                          placeholder="Type answer here..."
                          className="cosmic-input w-full p-4 text-center text-xl sm:text-2xl font-black rounded-2xl text-[#FBF6E9] placeholder:text-white/30"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (typedWord.trim()) {
                            submitAnswer({ text: typedWord.trim() });
                          }
                        }}
                        disabled={!typedWord.trim()}
                        className="btn-gold w-full py-4 rounded-2xl font-black text-lg shadow-xl active:scale-95 disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Send className="w-5 h-5" />
                        <span>Submit Answer</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. FEEDBACK REVEAL SCREEN */}
      {/* ========================================================================= */}
      {joined && (gameState === 'QUESTION_REVEAL' || (gameState === 'FEEDBACK' && !feedback)) && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 cosmic-canvas text-center animate-bounce-in overflow-hidden relative">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 border border-white/15 flex items-center justify-center mb-4 shadow-xl">
            <Sparkles className="w-8 h-8 sm:w-10 sm:h-10 text-[#FAC747] animate-pulse" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black drop-shadow mb-2 text-[#FBF6E9]">Question Ended!</h2>
          <p className="text-sm sm:text-base font-bold text-white/70">Answers are being revealed on the host screen...</p>
        </div>
      )}

      {joined && gameState === 'FEEDBACK' && feedback && (
        <div
          className={`flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 text-center animate-bounce-in overflow-y-auto touch-pan-y relative ${
            feedback.isCorrect && !feedback.isPartial
              ? 'bg-gradient-to-b from-[#063022] via-[#0F1433] to-[#080A1F]'
              : feedback.isPartial
              ? 'bg-gradient-to-b from-[#3d2703] via-[#0F1433] to-[#080A1F]'
              : 'bg-gradient-to-b from-[#3d0912] via-[#0F1433] to-[#080A1F]'
          }`}
        >
          {/* Big Checkmark / Partial Sparkles / Cross Icon */}
          <div className="w-18 h-18 sm:w-24 sm:h-24 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center mb-3 sm:mb-5 shadow-2xl shrink-0">
            {feedback.isCorrect && !feedback.isPartial ? (
              <Check className="w-10 h-10 sm:w-14 sm:h-14 text-emerald-400 stroke-[3]" />
            ) : feedback.isPartial ? (
              <Sparkles className="w-10 h-10 sm:w-14 sm:h-14 text-[#FAC747]" />
            ) : (
              <XCircle className="w-10 h-10 sm:w-14 sm:h-14 text-rose-400" />
            )}
          </div>

          <h1 className="text-3xl sm:text-5xl font-black mb-1 sm:mb-2 shrink-0 text-[#FBF6E9] tracking-tight">
            {feedback.isCorrect && !feedback.isPartial
              ? 'Correct!'
              : feedback.isPartial
              ? feedback.isExact
                ? 'Exact Match! 🎯'
                : 'Great Guess! ✨'
              : 'Incorrect'}
          </h1>

          {feedback.isPartial && (
            <p className="text-[11px] sm:text-xs font-bold text-[#FAC747] uppercase tracking-wider mb-1 shrink-0">
              Partial Points Awarded
            </p>
          )}

          {/* Points Banner */}
          <div className="cosmic-surface px-6 py-2 rounded-2xl text-xl sm:text-2xl font-black text-[#FAC747] tracking-wide my-2 shrink-0 shadow-lg border border-[#FAC747]/30">
            + {feedback.pointsEarned.toLocaleString()}
          </div>

          {/* Correct Answer Picks on Player Screen */}
          {feedback.options && feedback.options.length > 0 && (() => {
            const isPuzzle = feedback.questionType === 'puzzle';
            const baseOptions =
              feedback.options && feedback.options.length > 0
                ? feedback.options
                : (question?.options || []);

            const feedbackOpts = isPuzzle
              ? [...baseOptions].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
              : baseOptions;

            return (
              <div className="w-full max-w-sm my-2 p-3 bg-black/40 backdrop-blur-xl rounded-3xl border border-white/10 text-left shrink min-h-0 shadow-xl">
                <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-white/60 mb-2 text-center">
                  {isPuzzle ? 'Correct Chronological Order:' : 'Answer Choices & Results:'}
                </p>
                <div className="space-y-1.5 max-h-36 sm:max-h-48 overflow-y-auto touch-pan-y pr-1">
                  {feedbackOpts.map((opt: any, idx: number) => {
                    const isCorrectAnswer = (feedback.correctOptionIds || []).includes(opt.id) || Boolean(opt.isCorrect);
                    const isUserPick = (feedback.selectedOptionIds || []).includes(opt.id);
                    const itemIdx = opt.colorIndex ?? opt.originalIndex ?? idx;

                    return (
                      <div
                        key={opt.id}
                        className={`p-2.5 rounded-xl flex items-center justify-between text-xs font-bold transition-all ${
                          isCorrectAnswer
                            ? 'bg-emerald-500/20 border border-emerald-400/50 text-[#FBF6E9]'
                            : isUserPick
                            ? 'bg-red-500/20 border border-red-400/50 text-[#FBF6E9]/90'
                            : 'bg-white/5 text-[#FBF6E9]/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isPuzzle && (
                            <span className="w-5 h-5 rounded-full bg-white text-slate-900 font-black text-[10px] flex items-center justify-center shrink-0 shadow">
                              #{idx + 1}
                            </span>
                          )}
                          <ShapeIcon index={itemIdx} size={16} className="shrink-0" />
                          <span className="truncate">{opt.text}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          {!isPuzzle && isUserPick && (
                            <span className="text-[10px] bg-white/15 px-2 py-0.5 rounded-full font-black uppercase tracking-wider text-white/80">
                              Your Pick
                            </span>
                          )}
                          {isCorrectAnswer ? (
                            <div className="w-5 h-5 rounded-full bg-emerald-400 text-slate-900 flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                          ) : isUserPick ? (
                            <div className="w-5 h-5 rounded-full bg-rose-400 text-slate-900 flex items-center justify-center">
                              <X className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Number guess breakdown if number_guess question */}
          {feedback.questionType === 'number_guess' && feedback.numberTarget !== undefined && (
            <div className="w-full max-w-xs my-2 p-3 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 text-center shrink-0">
              <div className="flex items-center justify-around text-xs sm:text-sm font-black">
                <div>
                  <span className="text-[10px] sm:text-xs text-white/50 block">Target</span>
                  <span className="text-xl text-emerald-400 font-mono">{feedback.numberTarget}</span>
                </div>
                {feedback.playerGuess !== undefined && (
                  <div>
                    <span className="text-[10px] sm:text-xs text-white/50 block">Your Guess</span>
                    <span className="text-xl text-[#FAC747] font-mono">{feedback.playerGuess}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Word guess breakdown if word_guess question */}
          {feedback.questionType === 'word_guess' && (
            <div className="w-full max-w-sm my-2 p-3 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 text-center shrink-0">
              <div className="text-xs mb-2">
                <span className="text-[10px] text-white/50 uppercase font-black tracking-wider block">Your Submission</span>
                <span className="text-base font-black text-[#FAC747] font-mono">
                  {Array.isArray(feedback.userInput) ? feedback.userInput.join(', ') : (feedback.userInput || '(No Answer)')}
                </span>
              </div>
              {feedback.acceptedAnswers && feedback.acceptedAnswers.length > 0 && (
                <div className="border-t border-white/10 pt-2 text-left">
                  <span className="text-[10px] text-white/50 uppercase font-black tracking-wider block mb-1.5 text-center">
                    Accepted Answers
                  </span>
                  <div className="flex flex-wrap gap-1.5 justify-center max-h-24 overflow-y-auto">
                    {feedback.acceptedAnswers.map((ans: string, i: number) => {
                      const wasMatched = feedback.matchedAccepted && feedback.matchedAccepted.toLowerCase() === ans.toLowerCase();
                      return (
                        <span
                          key={i}
                          className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                            wasMatched
                              ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/50'
                              : 'bg-white/10 text-white/70'
                          }`}
                        >
                          {ans}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Streak indicator */}
          {feedback.streak >= 2 && (
            <div className="flex items-center gap-1.5 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 px-3.5 py-1 rounded-full font-black text-xs sm:text-sm shadow-lg mb-2 shrink-0">
              <Flame className="w-4 h-4 fill-amber-950" />
              <span>Answer streak 🔥 {feedback.streak}</span>
            </div>
          )}

          <p className="text-xs sm:text-sm text-[#FBF6E9]/80 shrink-0">
            Total Score: <span className="font-black text-[#FAC747]">{feedback.totalScore.toLocaleString()}</span>
          </p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. STANDING SCREEN */}
      {/* ========================================================================= */}
      {joined && (gameState === 'STANDING' || gameState === 'SCOREBOARD') && !standing && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 cosmic-canvas text-center animate-bounce-in overflow-hidden relative">
          <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-full bg-amber-400/10 border border-amber-400/25 flex items-center justify-center mb-4 shadow-xl">
            <Trophy className="w-9 h-9 sm:w-11 sm:h-11 text-[#FAC747] animate-pulse" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black drop-shadow mb-2 text-[#FBF6E9]">Scoreboard</h2>
          <p className="text-sm sm:text-base font-bold text-white/70">Look at the host screen for current standings...</p>
        </div>
      )}

      {joined && (gameState === 'STANDING' || gameState === 'SCOREBOARD') && standing && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 cosmic-canvas text-center animate-bounce-in overflow-y-auto touch-pan-y relative">
          <span className="text-xs font-black uppercase tracking-widest text-[#FAC747] mb-2 px-3 py-1 rounded-full bg-amber-400/10 border border-[#FAC747]/20">
            Your Standing
          </span>

          {standing.rank <= 5 ? (
            <div className="flex flex-col items-center animate-bounce-in">
              <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-amber-400/15 text-[#FAC747] mb-3 border-2 border-amber-400/30 shadow-[0_0_30px_rgba(250,199,71,0.3)] animate-pulse">
                <Trophy className="w-10 h-10 sm:w-12 sm:h-12 text-[#FAC747]" />
              </div>
              <h2 className="text-2xl sm:text-4xl font-black mb-2 text-[#FBF6E9] drop-shadow">
                You are on the Leaderboard
              </h2>
              <p className="text-xs sm:text-sm text-white/70 max-w-xs mb-4">
                Look at the host screen to see where you stand!
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center animate-bounce-in">
              <div className="text-5xl sm:text-7xl font-black text-[#FAC747] mb-2 font-mono drop-shadow-[0_0_25px_rgba(250,199,71,0.4)]">
                #{standing.rank}
              </div>
              <h2 className="text-xl sm:text-2xl font-black mb-3 text-[#FBF6E9]">
                You're in {getOrdinal(standing.rank)} place!
              </h2>

              {standing.leaderName && (
                <p className="text-xs sm:text-sm text-white/70 max-w-xs mb-4">
                  Behind {standing.leaderName} by {standing.pointsBehindLeader.toLocaleString()} pts
                </p>
              )}
            </div>
          )}

          <div className="cosmic-surface px-6 py-3 rounded-2xl font-black text-base border border-white/10 shadow-lg text-[#FBF6E9]">
            Score: <span className="text-[#FAC747]">{standing.score.toLocaleString()}</span> pts
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. FINAL RESULTS SCREEN */}
      {/* ========================================================================= */}
      {joined && (gameState === 'FINAL' || gameState === 'PODIUM') && !finalResult && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 cosmic-canvas text-center animate-bounce-in overflow-hidden relative">
          <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-full bg-amber-400/10 border border-amber-400/25 flex items-center justify-center mb-4 shadow-xl">
            <Trophy className="w-9 h-9 sm:w-11 sm:h-11 text-[#FAC747] animate-bounce" />
          </div>
          <h1 className="text-3xl sm:text-5xl font-black mb-2 text-[#FBF6E9]">Game Over!</h1>
          <p className="text-sm sm:text-base font-bold text-white/70">Loading final podium results...</p>
        </div>
      )}

      {joined && (gameState === 'FINAL' || gameState === 'PODIUM') && finalResult && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-8 cosmic-canvas text-center animate-bounce-in overflow-y-auto touch-pan-y relative">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-amber-400/15 border-2 border-amber-400/40 flex items-center justify-center mb-4 shadow-[0_0_40px_rgba(250,199,71,0.35)]">
            <Trophy
              className={`w-10 h-10 sm:w-14 sm:h-14 ${
                finalResult.isPodium ? 'text-[#FAC747] animate-bounce' : 'text-white/60'
              }`}
            />
          </div>

          <h1 className="text-3xl sm:text-5xl font-black mb-2 text-[#FBF6E9] tracking-tight">Game Over!</h1>
          <div className="text-xl sm:text-2xl font-black text-[#FAC747] mb-4">
            {finalResult.rank === 1
              ? '🏆 Champion (1st Place)!'
              : finalResult.rank <= 3
              ? `Podium Finish (${getOrdinal(finalResult.rank)})!`
              : `Finished #${finalResult.rank}`}
          </div>

          <div className="cosmic-hero-card px-8 py-4 rounded-3xl font-black text-lg sm:text-xl mb-6 shadow-2xl">
            Final Score: <span className="text-[#FAC747]">{finalResult.totalScore.toLocaleString()}</span> pts
          </div>

          <button
            onClick={() => {
              localStorage.removeItem('kahoot_pin');
              setPin('');
              setJoinedPin(null);
              setGameState('JOIN');
              setJoinStep('PIN');
              setPlayerInfo(null);
              setQuestion(null);
              setFeedback(null);
              setStanding(null);
              setFinalResult(null);
              setErrorMsg('');
              setSubmissionError('');
              setSearchParams({});
              navigate('/play');
            }}
            className="btn-gold px-8 py-3.5 rounded-full text-sm font-black shadow-lg shadow-amber-500/25 cursor-pointer active:scale-95 transition-all"
          >
            Play Another Game
          </button>
        </div>
      )}

      {/* Custom Emoji Avatar Picker Modal */}
      <EmojiPickerModal
        isOpen={isEmojiModalOpen}
        onClose={() => setIsEmojiModalOpen(false)}
        currentEmoji={selectedAvatar}
        onSelectEmoji={handleSelectAvatar}
      />

      {/* Persistent Player Career Profile Modal */}
      <PlayerProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        userUuid={userUuid}
        initialNickname={nickname}
        initialAvatar={selectedAvatar}
        onProfileUpdated={(updatedNick, updatedAvatar) => {
          if (updatedNick) setNickname(updatedNick);
          if (updatedAvatar) setSelectedAvatar(updatedAvatar);
        }}
      />
    </div>
  );
};
