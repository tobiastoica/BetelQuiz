import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { checkAuth, checkActiveGame } from '../utils/api';
import { getDeviceUuid, syncResilientDeviceUuid } from '../utils/device';
import { PlayCircle, ShieldCheck } from 'lucide-react';

export const Home: React.FC = () => {
  const [pin, setPin] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState<{ pin: string; nickname?: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth().then((res) => setIsAdmin(Boolean(res.authenticated)));

    syncResilientDeviceUuid().then((userUuid) => {
      checkActiveGame(userUuid).then((res) => {
        if (res.hasActiveGame && res.pin) {
          setHasSavedSession({ pin: res.pin, nickname: res.player?.nickname });
          navigate(`/play?pin=${res.pin}`);
        }
      });
    });
  }, [navigate]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = pin.trim().replace(/\s+/g, '');
    if (cleanPin) {
      navigate(`/play?pin=${cleanPin}`);
    }
  };

  const handleResume = () => {
    if (hasSavedSession) {
      navigate(`/play?pin=${hasSavedSession.pin}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#46178F] text-white">
      <Navbar isAdmin={isAdmin} />

      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-2xl text-slate-800 animate-bounce-in">
          {/* Logo */}
          <div className="mb-6 flex flex-col items-center">
            <div className="inline-block bg-[#46178F] text-white font-black text-4xl px-6 py-2 rounded-2xl shadow-lg mb-2 tracking-tight">
              BetelQuiz
            </div>
            <p className="text-slate-500 font-medium text-sm">Personal Live Quiz Host</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <input
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Game PIN"
                maxLength={6}
                autoFocus
                className="w-full text-center text-2xl font-black tracking-widest py-3.5 px-4 rounded-xl border-2 border-slate-300 focus:border-[#46178F] focus:outline-none placeholder:text-slate-400 placeholder:font-normal placeholder:tracking-normal transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={!pin.trim()}
              className="w-full py-4 rounded-xl bg-slate-900 hover:bg-black text-white font-black text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-40 disabled:hover:bg-slate-900 active:scale-95"
            >
              Enter
            </button>
          </form>

          {hasSavedSession && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                onClick={handleResume}
                className="w-full py-2.5 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <PlayCircle className="w-4 h-4" />
                Resume previous game (PIN: {hasSavedSession.pin})
              </button>
            </div>
          )}

          <div className="mt-6 text-xs text-slate-400">
            Hosted on <span className="font-semibold text-slate-600">quiz.tbsst.net</span>
          </div>
        </div>

        {/* Admin hint pill */}
        <div className="mt-8 flex items-center gap-2 bg-white/10 backdrop-blur px-4 py-2 rounded-full text-xs text-white/80">
          <ShieldCheck className="w-4 h-4 text-emerald-300" />
          <span>Host a game or create quizzes via the Admin button above</span>
        </div>
      </main>
    </div>
  );
};
