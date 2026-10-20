import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import confetti from 'canvas-confetti';
import QRCode from 'qrcode';
import {
  Volume2,
  VolumeX,
  Play,
  ArrowRight,
  Users,
  Trophy,
  Flame,
  Check,
  X,
  SkipForward,
  Settings,
  Maximize,
  Flag,
  Lock,
  Unlock,
  Shuffle,
  Palette,
  QrCode,
  Smartphone,
  CheckSquare,
  CheckCircle,
  Zap,
  ZapOff,
} from 'lucide-react';

import { socket, openSession } from '../utils/socket';
import { sound } from '../utils/audio';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useGetReadyStage } from '../hooks/useGetReadyStage';
import { BarChart } from '../components/BarChart';
import { NumberGuessDistribution } from '../components/NumberGuessDistribution';
import { PuzzleRevealBreakdown } from '../components/PuzzleRevealBreakdown';
import { QuestionTypeAnimation } from '../components/QuestionTypeAnimation';
import { KAHOOT_COLORS, ShapeIcon } from '../components/ShapeIcon';
import { getThemeClasses } from '../utils/theme';
import { WordCloudReveal } from '../components/WordCloudReveal';
import { PictureRevealGrid } from '../components/PictureRevealGrid';
import type { Player, LeaderboardEntry } from '../types/quiz';

export const Host: React.FC = () => {
  const { pin } = useParams<{ pin: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Host secret for this game (from the dashboard navigation, or remembered for a page refresh)
  const [hostSecret] = useState<string>(() => {
    const fromState = (location.state as any)?.hostSecret;
    if (fromState && pin) localStorage.setItem(`kahoot_host_secret_${pin}`, fromState);
    return fromState || (pin ? localStorage.getItem(`kahoot_host_secret_${pin}`) || '' : '');
  });

  // Host state
  const [gameState, setGameState] = useState<
    'LOBBY' | 'GET_READY' | 'QUESTION_ACTIVE' | 'QUESTION_REVEAL' | 'SCOREBOARD' | 'PODIUM'
  >('LOBBY');

  const [isMuted, setIsMuted] = useState(() => sound.isMuted);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [hostError, setHostError] = useState<string | null>(null);

  // Configuration sidebar & QR modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<string>('standard');
  const [gameSettings, setGameSettings] = useState({
    randomizeAnswers: false,
    randomizeQuestions: false,
    showQuestionsOnPlayerScreens: true,
    lockGame: false,
  });

  useEscapeKey(() => {
    setShowQrModal(false);
    setIsSettingsOpen(false);
  }, showQrModal || isSettingsOpen);

  // Active question state
  const [questionIndex, setQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(20);
  const [questionEndsAt, setQuestionEndsAt] = useState<number | undefined>(undefined);
  const [answersCount, setAnswersCount] = useState(0);
  // Theme and background of the screen on display; every screen's payload carries its own
  const [look, setLook] = useState<{ theme?: string; backgroundImage?: string }>({});
  const showLook = (data: { theme?: string; backgroundImage?: string }) =>
    setLook({ theme: data.theme, backgroundImage: data.backgroundImage });

  // Reveal state
  const [voteDistribution, setVoteDistribution] = useState<Record<string, number>>({});
  const [revealQuestion, setRevealQuestion] = useState<any>(null);
  const [revealNumberGuesses, setRevealNumberGuesses] = useState<any[]>([]);
  const [revealPuzzleStats, setRevealPuzzleStats] = useState<any>(null);
  const [revealWordSubmissions, setRevealWordSubmissions] = useState<Record<string, number>>({});

  // Scoreboard state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  // Podium state
  const [podiumData, setPodiumData] = useState<any>(null);

  // Progressive question feature reveal stage during GET_READY (1: Type, 2: Multi-select, 3: Points)
  const [readyEndsAt, setReadyEndsAt] = useState<number | undefined>(undefined);
  const getReadyStage = useGetReadyStage(gameState === 'GET_READY', readyEndsAt);

  // Question countdown with ticks, only while the question is on screen
  useEffect(() => {
    if (gameState !== 'QUESTION_ACTIVE' || questionEndsAt === undefined || hostError) return;
    const secondsLeft = () => Math.max(0, Math.ceil((questionEndsAt - Date.now()) / 1000));
    let shown = secondsLeft(); // already on screen (question_active sets it)
    if (shown === 0) return;

    const timer = setInterval(() => {
      const left = secondsLeft();
      if (left === shown) return;
      shown = left;
      setRemainingSeconds(left);
      if (left > 0) {
        sound.playCountdownTick(left <= 5);
      } else {
        clearInterval(timer);
        sound.playTimeUp();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [gameState, questionEndsAt, hostError]);

  // Sounds and confetti belong to arriving on a screen, so a replayed snapshot (reconnect) stays silent
  useEffect(() => {
    if (gameState === 'GET_READY' || gameState === 'QUESTION_REVEAL' || gameState === 'SCOREBOARD') {
      sound.playWhoosh();
    } else if (gameState === 'PODIUM') {
      sound.playFanfare();
      confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 } });
      const second = setTimeout(() => confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } }), 800);
      return () => clearTimeout(second);
    }
  }, [gameState]);

  // A closed or refused session silences the lobby music
  useEffect(() => {
    if (hostError) sound.stopLobbyMusic();
  }, [hostError]);

  // Join link displayed on projector
  const joinDomain = window.location.host;

  // Generate ultra-crisp vector SVG QR code (zero pixelation at 4K/projector sizes)
  useEffect(() => {
    if (!pin) return;
    const origin = window.location.origin;
    const targetUrl = window.location.hostname.includes('tbsst.net')
      ? `https://quiz.tbsst.net/play?game_id=${pin}`
      : `${origin}/play?game_id=${pin}`;

    // 1. Generate pure vector SVG
    QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((svg) => {
        setQrSvg(svg);
      })
      .catch((err) => {
        console.error('Failed to generate QR SVG:', err);
      });

    // 2. Generate 2400x2400 Ultra-HD PNG fallback
    QRCode.toDataURL(targetUrl, {
      width: 2400,
      margin: 1,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((url) => {
        setQrCodeDataUrl(url);
      })
      .catch((err) => {
        console.error('Failed to generate high-res QR data URL:', err);
      });
  }, [pin]);

  // One connection for this screen. The server re-attaches it on every reconnect and replays the
  // current state (host_game_data, then the event for the current screen), so other tabs and
  // refreshes always show the same thing.
  useEffect(() => {
    const handlers: Record<string, (data: any) => void> = {
      host_game_data: (data) => {
        setPlayers(data.players);
        setGameSettings(data.settings);
        setTotalQuestions(data.totalQuestions);
        setQuestionIndex(data.currentQuestionIndex);
        setGameState(data.state);
        if (data.state === 'LOBBY') {
          sound.playLobbyMusic();
        } else {
          sound.stopLobbyMusic();
        }
      },
      players_updated: (data) => setPlayers(data.players),
      settings_updated: (settings) => setGameSettings(settings),
      game_state_changed: (data) => {
        setGameState(data.state);
        if (data.state === 'GET_READY') {
          sound.stopLobbyMusic();
          setQuestionIndex(data.questionIndex);
          setCurrentQuestion(data.questionInfo);
          setReadyEndsAt(Date.now() + data.remainingTimeMs);
          showLook(data.questionInfo);
        }
      },
      question_active: (data) => {
        setGameState('QUESTION_ACTIVE');
        setCurrentQuestion(data.question);
        setQuestionIndex(data.questionIndex);
        setTotalQuestions(data.totalQuestions);
        setAnswersCount(data.answersReceived);
        setQuestionEndsAt(Date.now() + data.remainingTimeMs);
        setRemainingSeconds(Math.ceil(data.remainingTimeMs / 1000));
        showLook(data.question);
      },
      answer_count_updated: (data) => setAnswersCount(data.answersReceived),
      question_reveal: (data) => {
        setGameState('QUESTION_REVEAL');
        setQuestionIndex(data.questionIndex);
        setRevealQuestion(data.question);
        setVoteDistribution(data.voteDistribution || {});
        setRevealNumberGuesses(data.numberGuesses || []);
        setRevealPuzzleStats(data.puzzleStats || null);
        setRevealWordSubmissions(data.wordSubmissions || {});
        showLook(data.question);
      },
      scoreboard_update: (data) => {
        setGameState('SCOREBOARD');
        setQuestionIndex(data.questionIndex);
        setLeaderboard(data.leaderboard || []);
        showLook(data);
      },
      podium_update: (data) => {
        setGameState('PODIUM');
        setPodiumData(data);
        showLook(data);
      },
      host_error: (data) => setHostError(data.error || 'Host session unauthorized or expired.'),
      game_closed: (data) => setHostError(data.reason || 'This game has ended.'),
    };

    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    const closeSession = openSession({ role: 'host', pin: pin || '', hostSecret });
    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      closeSession();
      sound.stopLobbyMusic();
    };
  }, [pin, hostSecret]);

  const toggleSound = () => {
    const muted = sound.toggleMute();
    setIsMuted(muted);
    if (!muted && gameState === 'LOBBY') {
      sound.playLobbyMusic();
    }
  };

  const handleStartGame = () => {
    socket.emit('host_start_game');
  };

  // Next / Skip. The server ignores it if the game already left the screen the host is looking at
  // (timer ran out, everyone answered, another host tab), so it can never skip ahead.
  const handleAdvance = () => {
    socket.emit('host_next', { fromState: gameState, questionIndex });
  };

  // The second click of a double-click lands on the next screen's button (same spot), so only a
  // single click advances. Keyboard activation has detail 0.
  const handleAdvanceClick = (e: React.MouseEvent) => {
    if (e.detail <= 1) handleAdvance();
  };

  // Keyboard controls for host: Space or ArrowRight advances game
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isSettingsOpen || showQrModal) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowRight') {
        e.preventDefault();
        if (gameState === 'LOBBY') {
          if (players.length > 0) handleStartGame();
        } else if (gameState !== 'PODIUM') {
          handleAdvance();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, questionIndex, players.length, isSettingsOpen, showQrModal]);

  const handleEndGame = () => {
    if (window.confirm('Are you sure you want to end the game now and award the podium?')) {
      socket.emit('host_end_game');
    }
  };

  const handleKickPlayer = (userUuid: string) => {
    if (window.confirm('Remove this player from the game?')) {
      socket.emit('host_kick_player', { userUuid });
    }
  };

  const handleToggleSetting = (key: keyof typeof gameSettings) => {
    const updated = {
      ...gameSettings,
      [key]: !gameSettings[key],
    };
    setGameSettings(updated);
    socket.emit('host_update_settings', { settings: updated });
    if (key === 'showQuestionsOnPlayerScreens') {
      localStorage.setItem('kahoot_host_show_questions', String(updated.showQuestionsOnPlayerScreens));
    }
  };

  const handleSelectTheme = (themeName: string) => {
    setSelectedTheme(themeName);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // A finished game keeps its podium on screen when the server cleans it up later
  if (hostError && gameState !== 'PODIUM') {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center cosmic-canvas text-[#FBF6E9] p-6">
        <div className="max-w-md w-full cosmic-surface rounded-3xl p-8 border border-white/10 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-rose-500/20 text-rose-400 mx-auto flex items-center justify-center mb-4">
            <X className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black mb-2 text-[#FBF6E9]">Host Session Error</h2>
          <p className="text-white/60 text-sm mb-6">{hostError}</p>
          <button
            onClick={() => navigate('/admin/dashboard')}
            className="btn-gold w-full py-3.5 text-[#2A1A00] font-black rounded-xl transition shadow-lg cursor-pointer"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const themeStyle =
    gameState === 'LOBBY'
      ? getThemeClasses(selectedTheme)
      : getThemeClasses(look.theme || selectedTheme, look.backgroundImage);

  return (
    <div
      className={`h-[100dvh] max-h-screen w-screen flex flex-col justify-between overflow-hidden select-none text-white relative transition-all duration-500 ${themeStyle.className}`}
      style={themeStyle.style}
    >
      {/* Universal Top Controls (Header) */}
      <div className="fixed top-3 sm:top-4 right-3 sm:right-4 z-50 flex items-center gap-2">
        {/* Players counter badge in lobby */}
        {gameState === 'LOBBY' && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#0F1433]/80 backdrop-blur-md border border-white/15 text-[#FBF6E9] font-black text-sm shadow-lg">
            <Users className="w-4 h-4 text-[#5CC7B8]" />
            <span>{players.length}</span>
          </div>
        )}

        {/* Single Skip button in header during active question or get ready */}
        {(gameState === 'QUESTION_ACTIVE' || gameState === 'GET_READY') && (
          <button
            onClick={handleAdvanceClick}
            className="flex items-center gap-2 px-5 py-2 sm:px-6 sm:py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-[#FBF6E9] font-black text-sm uppercase tracking-wider shadow-2xl transition-all hover:scale-105 active:scale-95 cursor-pointer border border-white/15 backdrop-blur-md"
            title="Skip Question Timer"
          >
            <span>Skip</span>
            <SkipForward className="w-4 h-4 fill-current text-[#FAC747]" />
          </button>
        )}

        {/* Single Next button in header during question reveal or scoreboard */}
        {(gameState === 'QUESTION_REVEAL' || gameState === 'SCOREBOARD') && (
          <button
            onClick={handleAdvanceClick}
            className="btn-gold flex items-center gap-2 px-6 py-2.5 sm:px-7 sm:py-2.5 rounded-full text-[#2A1A00] font-black text-sm uppercase tracking-wider shadow-2xl transition-all hover:scale-105 active:scale-95 cursor-pointer"
            title="Next"
          >
            <span>Next</span>
            <ArrowRight className="w-4 h-4 stroke-[3]" />
          </button>
        )}

        {/* End Kahoot early button (visible when game is active) */}
        {gameState !== 'LOBBY' && gameState !== 'PODIUM' && (
          <button
            onClick={handleEndGame}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-black text-xs uppercase tracking-wider shadow-xl transition-all hover:scale-105 active:scale-95 cursor-pointer border border-rose-500/30 backdrop-blur-md"
            title="End game and award podium immediately"
          >
            <Flag className="w-3.5 h-3.5 fill-current" />
            <span>End Quiz</span>
          </button>
        )}

        {/* Audio mute toggle */}
        <button
          onClick={toggleSound}
          className="p-2.5 rounded-full bg-[#0F1433]/80 hover:bg-[#182046] backdrop-blur-md border border-white/15 text-[#FBF6E9] shadow-lg transition-transform hover:scale-110 active:scale-95 cursor-pointer"
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isMuted ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Volume2 className="w-5 h-5 text-[#FAC747]" />}
        </button>

        {/* QR Code toggle button in header (Lobby only) */}
        {gameState === 'LOBBY' && (
          <button
            onClick={() => setShowQrModal(true)}
            className="p-2.5 rounded-full bg-[#0F1433]/80 hover:bg-[#182046] backdrop-blur-md border border-white/15 text-[#FBF6E9] shadow-lg transition-transform hover:scale-110 active:scale-95 cursor-pointer flex items-center gap-1.5"
            title="Expand QR Code"
          >
            <QrCode className="w-5 h-5 text-[#5CC7B8]" />
            <span className="text-xs font-bold hidden sm:inline">QR Code</span>
          </button>
        )}

        {/* Settings gear button (Lobby only) */}
        {gameState === 'LOBBY' && (
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 rounded-full bg-[#0F1433]/80 hover:bg-[#182046] backdrop-blur-md border border-white/15 text-[#FBF6E9] shadow-lg transition-transform hover:scale-110 active:scale-95 cursor-pointer"
            title="Game Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={toggleFullscreen}
          className="p-2.5 rounded-full bg-[#0F1433]/80 hover:bg-[#182046] backdrop-blur-md border border-white/15 text-[#FBF6E9] shadow-lg transition-transform hover:scale-110 active:scale-95 cursor-pointer"
          title="Toggle Fullscreen"
        >
          <Maximize className="w-5 h-5" />
        </button>

        {/* Start button in header (Lobby only) */}
        {gameState === 'LOBBY' && (
          <button
            onClick={handleStartGame}
            disabled={players.length === 0}
            className="btn-gold px-5 py-2 rounded-full text-[#2A1A00] font-black text-sm shadow-xl hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 flex items-center gap-2 cursor-pointer transition-all"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Start</span>
          </button>
        )}
      </div>

      {/* Big QR Code Modal (Matching Image 2 & High-Res 4K Vector!) */}
      {showQrModal && (
        <div
          onClick={() => setShowQrModal(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-fade-in"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="QR Code and Join PIN"
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0F1433]/98 cosmic-surface text-[#FBF6E9] rounded-3xl p-6 sm:p-10 max-w-3xl sm:max-w-4xl w-[94vw] max-h-[94vh] shadow-2xl flex flex-col items-center relative animate-bounce-in border border-white/15 overflow-y-auto"
          >
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-3 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-8 h-8" />
            </button>

            <span className="btn-gold text-[#2A1A00] px-6 py-2 rounded-2xl font-black text-2xl sm:text-3xl shadow-lg mb-2 tracking-tight">
              BetelQuiz
            </span>

            <p className="text-xs sm:text-sm font-black uppercase tracking-wider text-white/50 mb-1">
              Join with phone or tablet:
            </p>
            <p className="text-xl sm:text-3xl font-black text-[#5CC7B8] mb-4">
              {joinDomain}/play?game_id={pin}
            </p>

            <div className="p-4 sm:p-6 bg-white rounded-3xl shadow-2xl border-4 border-white/20 mb-6 flex items-center justify-center w-[300px] h-[300px] sm:w-[460px] sm:h-[460px] md:w-[540px] md:h-[540px]">
              {qrSvg ? (
                <div
                  className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              ) : qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt="Big QR Code"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-800 py-12">
                  <QrCode className="w-24 h-24 text-[#FAC747] animate-pulse mb-3" />
                  <p className="font-bold text-base">Generating 4K QR code...</p>
                </div>
              )}
            </div>

            <div className="text-center">
              <p className="text-xs sm:text-sm font-bold text-white/50 uppercase tracking-widest">
                Game PIN:
              </p>
              <p className="text-5xl sm:text-6xl font-black tracking-widest text-[#FAC747] font-mono drop-shadow-[0_0_20px_rgba(250,199,71,0.5)]">
                {pin}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Settings Configuration Sidebar (Matching Image 1) */}
      {isSettingsOpen && (
        <div
          onClick={() => setIsSettingsOpen(false)}
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm h-full bg-[#0B0F24]/98 backdrop-blur-xl border-l border-white/10 text-[#FBF6E9] shadow-2xl flex flex-col justify-between p-6 overflow-y-auto animate-slide-left"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-[#FAC747]" />
                  <h2 className="text-xl font-black text-[#FBF6E9]">Game Settings</h2>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Hosting Controls */}
              <div className="mt-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-[#FAC747] mb-4">
                  Hosting Controls
                </h3>

                {/* Show questions & answers on player screens toggle */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#131938]/80 hover:bg-[#182046] transition-colors mb-3 border border-white/10">
                  <div className="pr-3">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-[#5CC7B8]" />
                      <span className="font-bold text-sm text-[#FBF6E9]">Show questions on devices</span>
                    </div>
                    <p className="text-xs text-white/50 mt-1">
                      Display question text and answer choices directly on player devices
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleSetting('showQuestionsOnPlayerScreens')}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 relative shrink-0 cursor-pointer ${
                      gameSettings.showQuestionsOnPlayerScreens ? 'bg-[#5CC7B8]' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        gameSettings.showQuestionsOnPlayerScreens ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Randomize order of answers toggle */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#131938]/80 hover:bg-[#182046] transition-colors mb-3 border border-white/10">
                  <div className="pr-3">
                    <div className="flex items-center gap-2">
                      <Shuffle className="w-4 h-4 text-[#FAC747]" />
                      <span className="font-bold text-sm text-[#FBF6E9]">Randomize order of answers</span>
                    </div>
                    <p className="text-xs text-white/50 mt-1">
                      Randomize answer choice positions for quiz & puzzle questions
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleSetting('randomizeAnswers')}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 relative shrink-0 cursor-pointer ${
                      gameSettings.randomizeAnswers ? 'bg-[#FAC747]' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        gameSettings.randomizeAnswers ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Randomize order of questions toggle */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#131938]/80 hover:bg-[#182046] transition-colors mb-3 border border-white/10">
                  <div className="pr-3">
                    <div className="flex items-center gap-2">
                      <Shuffle className="w-4 h-4 text-sky-400" />
                      <span className="font-bold text-sm text-[#FBF6E9]">Randomize order of questions</span>
                    </div>
                    <p className="text-xs text-white/50 mt-1">
                      Play questions in a randomized sequence
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleSetting('randomizeQuestions')}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 relative shrink-0 cursor-pointer ${
                      gameSettings.randomizeQuestions ? 'bg-sky-500' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        gameSettings.randomizeQuestions ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Lock game toggle */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#131938]/80 hover:bg-[#182046] transition-colors mb-3 border border-white/10">
                  <div className="pr-3">
                    <div className="flex items-center gap-2">
                      {gameSettings.lockGame ? (
                        <Lock className="w-4 h-4 text-rose-400" />
                      ) : (
                        <Unlock className="w-4 h-4 text-emerald-400" />
                      )}
                      <span className="font-bold text-sm text-[#FBF6E9]">Lock game</span>
                    </div>
                    <p className="text-xs text-white/50 mt-1">
                      Prevent new players from joining
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleSetting('lockGame')}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 relative shrink-0 cursor-pointer ${
                      gameSettings.lockGame ? 'bg-rose-500' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        gameSettings.lockGame ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Theme Picker */}
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <Palette className="w-4 h-4 text-[#FAC747]" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-[#FAC747]">
                    Lobby Theme
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'standard', name: 'Standard Cosmic', bg: 'bg-[#182046]' },
                    { id: 'spring', name: 'Spring Blossom', bg: 'bg-emerald-600' },
                    { id: 'summer', name: 'Summer Beach', bg: 'bg-sky-500' },
                    { id: 'autumn', name: 'Autumn Foliage', bg: 'bg-amber-600' },
                    { id: 'winter', name: 'Winter Frost', bg: 'bg-indigo-700' },
                    { id: 'dark', name: 'Cosmic Dark', bg: 'bg-slate-950' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTheme(t.id)}
                      className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                        selectedTheme === t.id
                          ? 'border-[#FAC747] bg-amber-400/10 text-[#FAC747] ring-2 ring-[#FAC747]/40'
                          : 'border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full ${t.bg} shrink-0 shadow`} />
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 text-center">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="btn-gold w-full py-3 rounded-xl text-[#2A1A00] font-bold text-sm shadow transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. LOBBY SCREEN */}
      {/* ========================================================================= */}
      {gameState === 'LOBBY' && (
        <div className="flex-1 flex flex-col justify-between p-8 md:p-12">
          {/* Top Banner with Game PIN */}
          <div className="flex flex-col items-center animate-float-up">
            <div className="cosmic-hero-card rounded-3xl px-8 py-5 shadow-2xl flex flex-col md:flex-row items-center gap-6 border border-white/15 backdrop-blur-xl bg-[#0F1433]/90 text-[#FBF6E9]">
              <div className="text-center md:text-left">
                <p className="text-xs font-black uppercase tracking-widest text-white/50">
                  Join with phone or tablet at:
                </p>
                <p className="text-2xl font-black text-[#5CC7B8]">{joinDomain}</p>
              </div>

              <div className="h-12 w-px bg-white/10 hidden md:block" />

              <div className="text-center">
                <p className="text-xs font-black uppercase tracking-widest text-white/50">
                  Game PIN:
                </p>
                <div className="text-5xl md:text-6xl font-black tracking-widest text-[#FAC747] font-mono drop-shadow-[0_0_25px_rgba(250,199,71,0.5)]">
                  {pin}
                </div>
              </div>

              {/* QR Code thumbnail button - Always visible */}
              <div
                onClick={() => setShowQrModal(true)}
                className="p-2.5 bg-white rounded-2xl shadow-xl border-2 border-white/20 hover:border-[#FAC747] cursor-pointer hover:scale-105 active:scale-95 transition-all group relative flex flex-col items-center justify-center min-w-[104px] min-h-[104px]"
                title="Click to view large 4K QR Code"
              >
                {qrSvg ? (
                  <div
                    className="w-20 h-20 sm:w-24 sm:h-24 [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : qrCodeDataUrl ? (
                  <img
                    src={qrCodeDataUrl}
                    alt="Join QR Code"
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-contain"
                  />
                ) : (
                  <div className="w-20 h-20 sm:w-24 sm:h-24 flex flex-col items-center justify-center text-slate-800">
                    <QrCode className="w-10 h-10 text-[#FAC747] mb-1 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Scan QR</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-[#0F1433]/30 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <Maximize className="w-6 h-6 text-[#FAC747] drop-shadow" />
                </div>
              </div>
            </div>
          </div>

          {/* Center Players Grid */}
          <div className="flex-1 my-8 flex flex-col items-center justify-center">
            {players.length === 0 ? (
              <div className="text-center">
                <div className="inline-block p-4 rounded-full bg-white/10 backdrop-blur animate-pulse mb-3">
                  <Users className="w-12 h-12 text-[#FAC747]" />
                </div>
                <h2 className="text-3xl font-black text-[#FBF6E9] drop-shadow-md">Waiting for players...</h2>
                <p className="text-white/60 text-sm mt-1">
                  Enter PIN <span className="font-bold text-[#FAC747] underline">{pin}</span> on your phone!
                </p>
              </div>
            ) : (
              <div className="w-full max-w-5xl">
                <div className="flex items-center justify-center gap-2 mb-6">
                  <Users className="w-6 h-6 text-[#5CC7B8]" />
                  <span className="text-2xl font-black text-[#FBF6E9]">{players.length} Players</span>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-4 max-h-96 overflow-y-auto p-4">
                  {players.map((p) => (
                    <div
                      key={p.userUuid}
                      onClick={() => handleKickPlayer(p.userUuid)}
                      className={`px-5 py-3 rounded-2xl bg-[#131938]/90 border border-white/15 text-[#FBF6E9] font-black text-xl shadow-xl flex items-center gap-3 animate-bounce-in cursor-pointer hover:bg-rose-500/20 hover:border-rose-500/40 hover:text-rose-300 transition-all group backdrop-blur-md ${
                        p.connected ? '' : 'opacity-50'
                      }`}
                      title={p.connected ? 'Click to remove player' : 'Reconnecting... (click to remove player)'}
                    >
                      <span className="text-2xl">{p.avatar}</span>
                      <span>{p.nickname}</span>
                      <X className="w-4 h-4 opacity-0 group-hover:opacity-100 text-rose-400 transition-opacity ml-1" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Bar with Start Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 bg-[#0F1433]/80 border border-white/10 backdrop-blur px-4 py-2 rounded-xl text-sm font-bold text-white/70">
              <span>Host View</span>
            </div>

            <button
              onClick={handleStartGame}
              disabled={players.length === 0}
              className="btn-gold px-10 py-4 rounded-2xl text-[#2A1A00] font-black text-2xl shadow-2xl hover:scale-105 transition-all active:scale-95 disabled:opacity-40 disabled:hover:scale-100 flex items-center gap-3 cursor-pointer"
            >
              <Play className="w-7 h-7 fill-current" />
              <span>Start</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. GET READY SCREEN */}
      {/* ========================================================================= */}
      {gameState === 'GET_READY' && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-bounce-in">
          <div className="cosmic-surface rounded-3xl p-8 md:p-12 shadow-2xl border border-white/15 max-w-2xl w-full flex flex-col items-center text-[#FBF6E9]">
            {/* Step 1: Animated Question Type */}
            <QuestionTypeAnimation type={currentQuestion?.type || 'quiz'} size={130} />

            <div className="bg-amber-400/10 border border-amber-400/20 text-[#FAC747] px-5 py-1.5 rounded-full font-black text-xs uppercase tracking-widest my-4">
              Question {currentQuestion?.index ?? ((questionIndex ?? 0) + 1)} of {currentQuestion?.total ?? totalQuestions}
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-[#FBF6E9] drop-shadow-lg leading-tight">
              {currentQuestion?.title || 'Get Ready!'}
            </h1>

            {/* Progressive Feature Reveal (Kahoot-style step 2 & step 3) */}
            <div className="flex flex-wrap items-center justify-center gap-3 mt-6 min-h-[56px]">
              {/* Step 2: Selection Mode Badge (Stage 2: 4s mark, quiz types only) */}
              {getReadyStage >= 2 && ['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(currentQuestion?.type || 'quiz') && (
                Boolean(currentQuestion?.isMultiSelect) ? (
                  <div className="animate-pop-badge flex items-center gap-3 px-6 py-2.5 rounded-2xl bg-[#5CC7B8]/20 border-2 border-[#5CC7B8] text-[#5CC7B8] shadow-[0_0_25px_rgba(92,199,184,0.35)] backdrop-blur-md">
                    <CheckSquare className="w-6 h-6 stroke-[2.5]" />
                    <div className="text-left">
                      <div className="font-black text-base sm:text-lg leading-tight uppercase tracking-wider">
                        Multi-Select
                      </div>
                      <div className="text-xs text-[#5CC7B8]/80 font-bold">
                        Select all correct answers
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="animate-pop-badge flex items-center gap-3 px-6 py-2.5 rounded-2xl bg-sky-500/15 border-2 border-sky-400 text-sky-300 shadow-[0_0_25px_rgba(56,189,248,0.25)] backdrop-blur-md">
                    <CheckCircle className="w-6 h-6 stroke-[2.5]" />
                    <div className="text-left">
                      <div className="font-black text-base sm:text-lg leading-tight uppercase tracking-wider">
                        Single Select
                      </div>
                      <div className="text-xs text-sky-200/80 font-bold">
                        Choose 1 answer
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* Step 3: Points Badge (Stage 3: 5s mark, only if not standard 1000 points) */}
              {getReadyStage >= 3 && (() => {
                const pts = currentQuestion?.points ?? 1000;
                if (pts === 1000) return null;
                const multiplier = pts / 1000;
                const isDouble = pts === 2000;
                const isZero = pts === 0;

                const multiplierStr = isZero
                  ? '0 Points'
                  : `x${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)} Points`;

                return (
                  <div className="animate-pop-badge flex items-center gap-3 px-6 py-2.5 rounded-2xl bg-amber-400/20 border-2 border-[#FAC747] text-[#FAC747] shadow-[0_0_25px_rgba(250,199,71,0.4)] backdrop-blur-md">
                    {isZero ? (
                      <ZapOff className="w-6 h-6 stroke-[2.5]" />
                    ) : (
                      <Zap className="w-6 h-6 stroke-[2.5] fill-current animate-pulse text-[#FAC747]" />
                    )}
                    <div className="text-left">
                      <div className="font-black text-base sm:text-lg leading-tight uppercase tracking-wider">
                        {multiplierStr}
                      </div>
                      <div className="text-xs text-[#FAC747]/80 font-bold">
                        {isZero
                          ? 'No points awarded'
                          : `${isDouble ? 'Double' : multiplier > 1 ? 'Bonus' : 'Adjusted'} points for this question`}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. QUESTION ACTIVE SCREEN (Full Viewport & Dynamic Sizing!) */}
      {/* ========================================================================= */}
      {gameState === 'QUESTION_ACTIVE' && currentQuestion && (
        <div className="flex-1 min-h-0 flex flex-col justify-between pt-14 sm:pt-16 pb-2 sm:pb-3 px-3 sm:px-6 md:px-8 w-full max-w-[98vw] mx-auto overflow-hidden">
          {/* Top Banner: Question Title */}
          <div className="w-full shrink-0">
            <div className="cosmic-surface rounded-2xl sm:rounded-3xl px-6 sm:px-10 py-3 sm:py-4 shadow-2xl text-center border border-white/15 animate-float-up text-[#FBF6E9]">
              <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black leading-tight tracking-tight">
                {currentQuestion.title}
              </h2>
            </div>
          </div>

          {/* Center Area: Left Timer, Center Image, Right Answers Count */}
          <div className="flex-1 min-h-0 flex items-center justify-between w-full my-1 sm:my-2 px-2 sm:px-6 gap-2 sm:gap-6">
            {/* Left Solid Gold Circle Timer Counter */}
            <div className="shrink-0 flex flex-col items-center select-none">
              <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full bg-gradient-to-tr from-[#131938] to-[#1E2756] border-[4px] border-[#FAC747]/70 shadow-[0_0_25px_rgba(250,199,71,0.3)] flex items-center justify-center">
                <span className="text-[#FAC747] font-black text-3xl sm:text-4xl md:text-5xl tracking-tighter drop-shadow-md">
                  {remainingSeconds}
                </span>
              </div>
            </div>

            {/* Center Media Image / Graphic / Picture Reveal Grid */}
            <div className="flex-1 min-h-0 flex items-center justify-center max-h-[30vh] sm:max-h-[36vh] overflow-hidden px-2">
              {currentQuestion.type === 'picture_reveal' ? (
                <PictureRevealGrid
                  imageUrl={currentQuestion.image}
                  tileLevel={currentQuestion.tileLevel || 'medium'}
                  durationSeconds={currentQuestion.timeLimit || 20}
                  endsAt={questionEndsAt}
                  className="max-h-[28vh] sm:max-h-[34vh]"
                />
              ) : currentQuestion.image ? (
                <div className="rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border-2 sm:border-4 border-white/40 bg-black/40 max-h-[28vh] sm:max-h-[34vh] max-w-[60vw] flex items-center justify-center">
                  <img
                    src={currentQuestion.image}
                    alt="Media"
                    className="max-h-[28vh] sm:max-h-[34vh] max-w-[60vw] w-auto h-auto object-contain"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-4 sm:p-6 rounded-2xl sm:rounded-3xl cosmic-surface border border-white/15 shadow-xl text-[#FBF6E9]">
                  <QuestionTypeAnimation type={currentQuestion.type || 'quiz'} size={100} showLabel={false} />
                  <span className="text-[#FBF6E9] font-black text-sm sm:text-base mt-2">
                    Question {questionIndex + 1}
                  </span>
                </div>
              )}
            </div>

            {/* Right Solid Teal Circle Answers Counter & Pill */}
            <div className="shrink-0 flex flex-col items-center select-none">
              <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full bg-gradient-to-tr from-[#131938] to-[#1E2756] border-[4px] border-[#5CC7B8]/70 shadow-[0_0_25px_rgba(92,199,184,0.3)] flex items-center justify-center relative">
                <span className="text-[#5CC7B8] font-black text-3xl sm:text-4xl md:text-5xl tracking-tighter drop-shadow-md">
                  {answersCount}
                </span>
                <div className="absolute -bottom-2 sm:-bottom-2.5 bg-[#0F1433] border border-[#5CC7B8]/50 text-[#5CC7B8] px-3 sm:px-4 py-0.5 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider shadow-lg">
                  Answers
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Answer Blocks */}
          <div className="w-full shrink-0">
            <div
              className={`grid gap-2.5 sm:gap-3 ${
                (currentQuestion.options || []).length <= 4
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1 md:grid-cols-3'
              }`}
            >
              {(currentQuestion.options || []).map((opt: any, idx: number) => {
                const itemIdx = opt.colorIndex ?? idx;
                const color = KAHOOT_COLORS[itemIdx % KAHOOT_COLORS.length];
                const hasImg = Boolean(currentQuestion.image);
                return (
                  <div
                    key={opt.id}
                    className={`${color.bg} rounded-2xl ${
                      hasImg
                        ? 'p-2.5 sm:p-3.5 min-h-[50px] sm:min-h-[62px] md:min-h-[72px]'
                        : 'p-3 sm:p-4 min-h-[55px] sm:min-h-[68px] md:min-h-[78px]'
                    } shadow-xl border border-white/20 flex items-center gap-3 sm:gap-4 text-white animate-bounce-in`}
                  >
                    <ShapeIcon index={itemIdx} size={hasImg ? 28 : 32} className="shrink-0 drop-shadow" />
                    <span className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-black flex-1 line-clamp-2">
                      {opt.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. QUESTION REVEAL SCREEN (Supporting Bar Chart & Number Distribution!) */}
      {/* ========================================================================= */}
      {gameState === 'QUESTION_REVEAL' && revealQuestion && (
        <div className="flex-1 min-h-0 flex flex-col justify-between pt-14 sm:pt-16 pb-2 sm:pb-3 px-3 sm:px-6 md:px-8 w-full max-w-[98vw] mx-auto overflow-hidden">
          {/* Top Banner (Positioned comfortably below fixed top bar) */}
          <div className="w-full shrink-0">
            <div className="cosmic-surface rounded-2xl sm:rounded-3xl px-6 sm:px-10 py-3 sm:py-4 shadow-2xl text-center border border-white/12 text-[#FBF6E9]">
              <h2 className="text-xl sm:text-2xl md:text-3xl font-black leading-tight">
                {revealQuestion.title}
              </h2>
            </div>
          </div>

          {/* Center: Depending on question type */}
          <div className="flex-1 min-h-0 flex items-center justify-center my-1 sm:my-3 w-full">
            {revealQuestion.type === 'word_guess' ? (
              <WordCloudReveal
                wordSubmissions={revealWordSubmissions}
                acceptedAnswers={revealQuestion.acceptedAnswers || []}
              />
            ) : revealQuestion.type === 'picture_reveal' ? (
              <PictureRevealGrid
                imageUrl={revealQuestion.image}
                tileLevel={revealQuestion.tileLevel || 'medium'}
                fullyRevealed={true}
                className="max-h-[30vh] sm:max-h-[36vh]"
              />
            ) : revealQuestion.type === 'number_guess' ? (
              <NumberGuessDistribution
                target={revealQuestion.numberTarget ?? 50}
                min={revealQuestion.numberMin ?? 0}
                max={revealQuestion.numberMax ?? 100}
                guesses={revealNumberGuesses}
              />
            ) : revealQuestion.type === 'puzzle' ? (
              <PuzzleRevealBreakdown
                stats={revealPuzzleStats}
                totalAnswers={Object.values(voteDistribution).reduce((a, b) => a + b, 0)}
              />
            ) : (
              <BarChart
                options={revealQuestion.options || []}
                voteDistribution={voteDistribution}
                totalAnswers={Object.values(voteDistribution).reduce((a, b) => a + b, 0)}
              />
            )}
          </div>

          {/* Bottom Answer Blocks with Correct / Incorrect Marks */}
          {revealQuestion.options && revealQuestion.options.length > 0 && (() => {
            const isPuzzle = revealQuestion.type === 'puzzle';
            const displayOptions = isPuzzle
              ? [...(revealQuestion.options || [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
              : revealQuestion.options || [];

            return (
              <div className="w-full shrink-0">
                {isPuzzle && (
                  <div className="flex items-center justify-between mb-2 px-2">
                    <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white drop-shadow flex items-center gap-2">
                      <span>Correct Chronological Order</span>
                      <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full font-bold">1 to {displayOptions.length}</span>
                    </span>
                  </div>
                )}
                <div
                  className={`grid gap-2.5 sm:gap-3 ${
                    isPuzzle
                      ? displayOptions.length <= 4
                        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                      : displayOptions.length <= 4
                      ? 'grid-cols-1 md:grid-cols-2'
                      : 'grid-cols-1 md:grid-cols-3'
                  }`}
                >
                  {displayOptions.map((opt: any, idx: number) => {
                    const itemIdx = opt.colorIndex ?? opt.originalIndex ?? idx;
                    const color = KAHOOT_COLORS[itemIdx % KAHOOT_COLORS.length];
                    const isCorrect = isPuzzle ? true : Boolean(opt.isCorrect);

                    return (
                      <div
                        key={opt.id}
                        className={`${color.bg} ${
                          !isCorrect ? 'opacity-40 grayscale-[40%]' : 'ring-4 ring-white shadow-xl'
                        } rounded-2xl p-2.5 sm:p-3.5 flex items-center justify-between text-white min-h-[50px] sm:min-h-[62px] md:min-h-[72px] transition-all`}
                      >
                        <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
                          {isPuzzle && (
                            <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white text-slate-950 font-black text-sm sm:text-base flex items-center justify-center shrink-0 shadow border border-slate-200">
                              #{idx + 1}
                            </span>
                          )}
                          <ShapeIcon index={itemIdx} size={26} className="shrink-0 drop-shadow" />
                          <span className="text-base sm:text-lg md:text-xl font-black line-clamp-2">{opt.text}</span>
                        </div>

                        <div className="shrink-0 ml-2 sm:ml-3">
                          {isCorrect ? (
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white text-[#26890C] flex items-center justify-center shadow">
                              <Check className="w-5 h-5 stroke-[3.5]" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/40 text-white/80 flex items-center justify-center">
                              <X className="w-5 h-5 stroke-[3]" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. SCOREBOARD SCREEN */}
      {/* ========================================================================= */}
      {gameState === 'SCOREBOARD' && (
        <div className="flex-1 min-h-0 flex flex-col justify-between pt-14 sm:pt-16 pb-4 px-4 sm:px-8 max-w-4xl mx-auto w-full overflow-hidden text-[#FBF6E9]">
          {/* Header */}
          <div className="flex items-center justify-center w-full shrink-0">
            <div className="cosmic-surface px-8 py-3 rounded-2xl border border-white/15 text-center text-[#FBF6E9] shadow-xl">
              <span className="text-xs font-black uppercase tracking-widest text-[#FAC747] block">
                Scoreboard
              </span>
              <h1 className="text-2xl sm:text-3xl font-black drop-shadow text-[#FBF6E9]">
                Leaderboard
              </h1>
            </div>
          </div>

          {/* Top 5 Leaderboard List */}
          <div className="flex-1 min-h-0 max-w-4xl mx-auto w-full flex flex-col justify-center my-2 sm:my-4 space-y-2 sm:space-y-2.5">
            {leaderboard.map((player, idx) => (
              <div
                key={player.userUuid}
                className="cosmic-surface bg-[#131938]/90 text-[#FBF6E9] border border-white/12 rounded-2xl p-3.5 sm:p-4 shadow-xl flex items-center justify-between animate-float-up"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-base shadow ${
                      idx === 0
                        ? 'bg-gradient-to-tr from-[#FAC747] to-[#DB941F] text-[#2A1A00]'
                        : idx === 1
                        ? 'bg-slate-300 text-slate-900'
                        : idx === 2
                        ? 'bg-amber-600 text-white'
                        : 'bg-white/10 text-white'
                    }`}
                  >
                    {player.rank}
                  </div>
                  <span className="text-xl sm:text-2xl">{player.avatar}</span>
                  <span className="text-lg sm:text-xl font-black">{player.nickname}</span>

                  {player.streak >= 2 && (
                    <div className="flex items-center gap-1 bg-amber-400/20 text-[#FAC747] border border-amber-400/30 px-2 py-0.5 rounded-full text-xs font-bold">
                      <Flame className="w-3.5 h-3.5 fill-[#FAC747]" />
                      <span>{player.streak} streak</span>
                    </div>
                  )}
                </div>

                <div className="text-xl sm:text-2xl font-black text-[#FAC747] font-mono">
                  {player.score.toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center text-xs text-white/60 bg-[#0F1433]/80 border border-white/10 backdrop-blur inline-block px-4 py-1.5 rounded-full mx-auto">
            Top 5 players displayed
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. PODIUM SCREEN (Fixed Sizing & Guaranteed Gold Supremacy!) */}
      {/* ========================================================================= */}
      {gameState === 'PODIUM' && podiumData && (
        <div className="flex-1 min-h-0 flex flex-col justify-between p-2 sm:p-4 md:p-6 text-center overflow-y-auto text-[#FBF6E9]">
          {/* Header Card with High Contrast */}
          <div className="shrink-0 pt-1 sm:pt-2">
            <div className="cosmic-surface bg-[#0F1433]/90 backdrop-blur-md px-6 sm:px-8 py-2.5 sm:py-3.5 rounded-2xl inline-block shadow-2xl border border-white/15 mx-auto">
              <div className="inline-flex items-center gap-2 bg-amber-400/15 border border-amber-400/25 px-3 py-0.5 rounded-full font-black text-xs tracking-wider uppercase mb-1 text-[#FAC747]">
                <Trophy className="w-4 h-4 text-[#FAC747]" />
                <span>Final Results</span>
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-[#FBF6E9] drop-shadow-lg">
                BetelQuiz Champions
              </h1>
            </div>
          </div>

          {/* 3-Tier Olympic Podium */}
          <div className="flex items-end justify-center gap-2 sm:gap-4 md:gap-6 max-w-4xl mx-auto w-full my-1 sm:my-3">
            {/* 2nd Place (Silver) */}
            <div className="flex-1 max-w-[190px] flex flex-col items-center justify-end">
              <div className="min-h-[75px] sm:min-h-[90px] md:min-h-[105px] flex flex-col items-center justify-end pb-1.5">
                {podiumData.second ? (
                  <div className="flex flex-col items-center animate-bounce-in">
                    <span className="text-2xl sm:text-3xl md:text-4xl">{podiumData.second.avatar}</span>
                    <span className="font-black text-sm sm:text-base md:text-lg text-white drop-shadow mt-0.5 line-clamp-1">
                      {podiumData.second.nickname}
                    </span>
                    <span className="text-[11px] sm:text-xs font-bold text-white/90 bg-black/40 px-2 py-0.5 rounded-full mt-0.5">
                      {podiumData.second.score.toLocaleString()} pts
                    </span>
                  </div>
                ) : (
                  <div className="text-white/40 font-bold text-xs bg-black/20 px-2.5 py-0.5 rounded-full">-</div>
                )}
              </div>
              <div className="w-full bg-gradient-to-b from-slate-200 to-slate-400 text-slate-800 rounded-t-3xl h-24 sm:h-28 md:h-36 lg:h-44 shadow-2xl flex flex-col items-center justify-center font-black border-t-4 border-white/60 shrink-0">
                <span className="text-3xl sm:text-4xl md:text-5xl font-black">2</span>
                <span className="text-[10px] sm:text-xs uppercase tracking-widest text-slate-600 font-extrabold mt-0.5">Silver</span>
              </div>
            </div>

            {/* 1st Place (Gold Champion) - ALWAYS TALLEST! */}
            <div className="flex-1 max-w-[210px] flex flex-col items-center justify-end">
              <div className="min-h-[90px] sm:min-h-[110px] md:min-h-[125px] flex flex-col items-center justify-end pb-1.5">
                {podiumData.first ? (
                  <div className="flex flex-col items-center animate-bounce-in">
                    <Trophy className="w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 text-[#FAC747] mb-0.5 animate-bounce drop-shadow" />
                    <span className="text-3xl sm:text-4xl md:text-5xl">{podiumData.first.avatar}</span>
                    <span className="font-black text-base sm:text-lg md:text-xl text-[#FBF6E9] drop-shadow mt-0.5 line-clamp-1">
                      {podiumData.first.nickname}
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-[#FAC747] bg-black/50 px-2.5 py-0.5 rounded-full mt-0.5 border border-amber-400/30">
                      {podiumData.first.score.toLocaleString()} pts
                    </span>
                  </div>
                ) : (
                  <div className="text-white/40 font-bold text-xs bg-black/20 px-2.5 py-0.5 rounded-full">-</div>
                )}
              </div>
              <div className="w-full bg-gradient-to-b from-[#FAC747] via-[#DB941F] to-[#996000] text-[#2A1A00] rounded-t-3xl h-32 sm:h-40 md:h-48 lg:h-56 shadow-2xl flex flex-col items-center justify-center font-black border-t-4 border-yellow-200 ring-4 ring-[#FAC747]/40 shrink-0">
                <span className="text-4xl sm:text-5xl md:text-6xl font-black">1</span>
                <span className="text-xs sm:text-sm uppercase tracking-widest text-[#2A1A00] font-black mt-0.5">Champion</span>
              </div>
            </div>

            {/* 3rd Place (Bronze) */}
            <div className="flex-1 max-w-[190px] flex flex-col items-center justify-end">
              <div className="min-h-[65px] sm:min-h-[80px] md:min-h-[95px] flex flex-col items-center justify-end pb-1.5">
                {podiumData.third ? (
                  <div className="flex flex-col items-center animate-bounce-in">
                    <span className="text-2xl sm:text-3xl">{podiumData.third.avatar}</span>
                    <span className="font-black text-xs sm:text-sm md:text-base text-white drop-shadow mt-0.5 line-clamp-1">
                      {podiumData.third.nickname}
                    </span>
                    <span className="text-[11px] sm:text-xs font-bold text-white/90 bg-black/40 px-2 py-0.5 rounded-full mt-0.5">
                      {podiumData.third.score.toLocaleString()} pts
                    </span>
                  </div>
                ) : (
                  <div className="text-white/40 font-bold text-xs bg-black/20 px-2.5 py-0.5 rounded-full">-</div>
                )}
              </div>
              <div className="w-full bg-gradient-to-b from-[#D27D2D] to-[#A0522D] text-amber-950 rounded-t-3xl h-20 sm:h-24 md:h-28 lg:h-32 xl:h-36 shadow-2xl flex flex-col items-center justify-center font-black border-t-4 border-amber-300/40 shrink-0">
                <span className="text-2xl sm:text-3xl md:text-4xl font-black text-amber-100">3</span>
                <span className="text-[10px] sm:text-xs uppercase tracking-widest text-amber-200 font-extrabold mt-0.5">Bronze</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-4 pb-2 shrink-0">
            <button
              onClick={() => navigate('/admin/dashboard')}
              className="btn-gold px-8 py-3 rounded-2xl text-[#2A1A00] font-black text-sm sm:text-base shadow-xl hover:scale-105 active:scale-95 cursor-pointer"
            >
              Exit to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
