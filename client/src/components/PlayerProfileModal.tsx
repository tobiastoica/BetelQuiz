import React, { useEffect, useState } from 'react';
import { X, Trophy, Flame, Target, Award, History, User, Check, Edit2 } from 'lucide-react';
import type { PlayerProfile } from '../types/quiz';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface PlayerProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userUuid: string;
  initialNickname?: string;
  initialAvatar?: string;
  onProfileUpdated?: (nickname: string, avatar: string) => void;
}

export const PlayerProfileModal: React.FC<PlayerProfileModalProps> = ({
  isOpen,
  onClose,
  userUuid,
  initialNickname = '',
  initialAvatar = '🦊',
  onProfileUpdated,
}) => {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editNickname, setEditNickname] = useState(initialNickname);
  const [editAvatar, setEditAvatar] = useState(initialAvatar);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const AVATARS = ['🦊', '🐼', '🦁', '🐯', '🐨', '🐵', '🦄', '🚀', '⚡', '🌟', '🐬', '🦉'];

  useEffect(() => {
    if (!isOpen || !userUuid) return;

    setLoading(true);
    fetch('/api/player/profile')
      .then((res) => res.json())
      .then((data) => {
        if (data.profile) {
          setProfile(data.profile);
          setEditNickname(data.profile.nickname || initialNickname);
          setEditAvatar(data.profile.avatar || initialAvatar);
        }
      })
      .catch((err) => console.error('Failed to load profile:', err))
      .finally(() => setLoading(false));
  }, [isOpen, userUuid, initialNickname, initialAvatar]);

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  const handleSaveIdentity = async () => {
    try {
      const res = await fetch('/api/player/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: editNickname.trim(),
          avatar: editAvatar,
        }),
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
        setIsEditing(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        if (onProfileUpdated) {
          onProfileUpdated(data.profile.nickname, data.profile.avatar);
        }
      }
    } catch (err) {
      console.error('Failed to save profile identity:', err);
    }
  };

  const nickname = profile?.nickname || initialNickname || 'Anonymous Player';
  const avatar = profile?.avatar || initialAvatar || '🦊';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Player Profile"
        className="relative w-full max-w-2xl bg-[#0F1433]/98 cosmic-surface border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#FBF6E9]"
      >
        {/* Header / Identity Banner */}
        <div className="relative p-6 sm:p-8 bg-gradient-to-br from-[#182046]/90 via-[#0F1433] to-[#080A1F] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-[#FAC747] to-[#DB941F] flex items-center justify-center text-4xl sm:text-5xl shadow-xl ring-4 ring-white/10">
                {avatar}
              </div>
              {isEditing && (
                <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center">
                  <Edit2 className="w-6 h-6 text-white" />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl sm:text-3xl font-black text-[#FBF6E9]">{nickname}</h2>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition cursor-pointer"
                    title="Edit nickname & avatar"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-xs text-[#FAC747] font-mono tracking-wider mt-0.5">
                ID: {userUuid.slice(0, 12)}...
              </p>
              {saveSuccess && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-bold mt-1">
                  <Check className="w-3.5 h-3.5" /> Updated!
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Identity Edit Panel */}
        {isEditing && (
          <div className="p-6 bg-[#131938]/90 border-b border-white/10 animate-in slide-in-from-top duration-200">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-white/70 uppercase tracking-wider mb-1.5">
                  Nickname
                </label>
                <input
                  type="text"
                  value={editNickname}
                  maxLength={20}
                  onChange={(e) => setEditNickname(e.target.value)}
                  placeholder="Enter your nickname..."
                  className="w-full px-4 py-2.5 bg-[#0F1433] border border-white/15 rounded-xl text-[#FBF6E9] font-bold focus:outline-none focus:border-[#FAC747]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white/70 uppercase tracking-wider mb-1.5">
                  Choose Avatar
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVATARS.map((av) => (
                    <button
                      key={av}
                      type="button"
                      onClick={() => setEditAvatar(av)}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition cursor-pointer ${
                        editAvatar === av
                          ? 'bg-amber-400/20 border-2 border-[#FAC747] ring-2 ring-[#FAC747]/40 scale-110 shadow-lg'
                          : 'bg-white/5 hover:bg-white/15 border border-white/5'
                      }`}
                    >
                      {av}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveIdentity}
                  className="btn-gold px-5 py-2 rounded-xl text-xs font-black text-[#2A1A00] shadow-lg transition cursor-pointer"
                >
                  Save Profile
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content Body: Career Stats & Recent History */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-6 flex-1 overscroll-contain will-change-scroll transform-gpu">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mr-3" />
              Loading career stats...
            </div>
          ) : (
            <>
              {/* Career Stats Grid */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-indigo-400" /> Career Milestones
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {/* Wins */}
                  <div className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-900/20 border border-amber-500/30 rounded-2xl flex flex-col justify-between">
                    <div className="flex items-center justify-between text-amber-400">
                      <span className="text-xs font-bold uppercase tracking-wider">Victories</span>
                      <Trophy className="w-5 h-5" />
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-black text-white">{profile?.wins || 0}</span>
                      <span className="text-xs text-amber-300/70 block">1st place finishes</span>
                    </div>
                  </div>

                  {/* Podiums */}
                  <div className="p-4 bg-gradient-to-br from-purple-500/10 to-purple-900/20 border border-purple-500/30 rounded-2xl flex flex-col justify-between">
                    <div className="flex items-center justify-between text-purple-400">
                      <span className="text-xs font-bold uppercase tracking-wider">Podiums</span>
                      <Award className="w-5 h-5" />
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-black text-white">{profile?.podiums || 0}</span>
                      <span className="text-xs text-purple-300/70 block">Top 3 finishes</span>
                    </div>
                  </div>

                  {/* Games Played */}
                  <div className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-900/20 border border-blue-500/30 rounded-2xl flex flex-col justify-between">
                    <div className="flex items-center justify-between text-blue-400">
                      <span className="text-xs font-bold uppercase tracking-wider">Games</span>
                      <History className="w-5 h-5" />
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-black text-white">{profile?.gamesPlayed || 0}</span>
                      <span className="text-xs text-blue-300/70 block">Total played</span>
                    </div>
                  </div>

                  {/* Highest Streak */}
                  <div className="p-4 bg-gradient-to-br from-rose-500/10 to-rose-900/20 border border-rose-500/30 rounded-2xl flex flex-col justify-between">
                    <div className="flex items-center justify-between text-rose-400">
                      <span className="text-xs font-bold uppercase tracking-wider">Max Streak</span>
                      <Flame className="w-5 h-5" />
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-black text-white">{profile?.highestStreak || 0}</span>
                      <span className="text-xs text-rose-300/70 block">Consecutive correct</span>
                    </div>
                  </div>

                  {/* Accuracy */}
                  <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-emerald-900/20 border border-emerald-500/30 rounded-2xl flex flex-col justify-between">
                    <div className="flex items-center justify-between text-emerald-400">
                      <span className="text-xs font-bold uppercase tracking-wider">Accuracy</span>
                      <Target className="w-5 h-5" />
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-black text-white">
                        {profile?.accuracyPercentage || 0}%
                      </span>
                      <span className="text-xs text-emerald-300/70 block">Overall precision</span>
                    </div>
                  </div>

                  {/* Total Career Score */}
                  <div className="p-4 bg-gradient-to-br from-indigo-500/10 to-indigo-900/20 border border-indigo-500/30 rounded-2xl flex flex-col justify-between">
                    <div className="flex items-center justify-between text-indigo-400">
                      <span className="text-xs font-bold uppercase tracking-wider">Total Score</span>
                      <User className="w-5 h-5" />
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-black text-white">
                        {(profile?.totalScore || 0).toLocaleString()}
                      </span>
                      <span className="text-xs text-indigo-300/70 block">Points accrued</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Games List */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-400" /> Recent Quiz Matches
                </h3>

                {profile?.recentGames && profile.recentGames.length > 0 ? (
                  <div className="space-y-2">
                    {profile.recentGames.slice(0, 10).map((game, idx) => {
                      const isFirst = game.rank === 1;
                      const isPodium = game.rank <= 3;

                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3.5 bg-slate-800/60 hover:bg-slate-800/90 border border-white/5 rounded-2xl transition"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shadow ${
                                isFirst
                                  ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300'
                                  : isPodium
                                  ? 'bg-purple-500 text-white'
                                  : 'bg-slate-700 text-slate-300'
                              }`}
                            >
                              #{game.rank}
                            </div>
                            <div>
                              <div className="font-bold text-white text-sm">{game.quizTitle}</div>
                              <div className="text-[11px] text-slate-400">
                                {new Date(game.playedAt).toLocaleDateString()} • {game.totalPlayers}{' '}
                                players
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-black text-sm text-indigo-300">
                              {game.score.toLocaleString()} pts
                            </div>
                            <div className="text-[11px] text-emerald-400 font-semibold">
                              {game.accuracy}% accuracy
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 bg-slate-800/30 rounded-2xl border border-white/5 text-sm">
                    No games played yet. Join a live quiz to begin your career records!
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
