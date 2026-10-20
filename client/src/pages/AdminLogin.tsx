import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../utils/api';
import { ShieldCheck, Lock, User, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export const AdminLogin: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login(username, password);
      if (res.success) {
        navigate('/admin/dashboard');
      } else {
        setError(res.error || 'Invalid credentials');
      }
    } catch {
      setError('Connection failed. Please check server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center cosmic-canvas text-[#FBF6E9] p-6 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute w-96 h-96 rounded-full bg-indigo-600/15 blur-[120px] pointer-events-none -top-20 -left-20 animate-pulse" />
      <div className="absolute w-96 h-96 rounded-full bg-amber-500/10 blur-[120px] pointer-events-none -bottom-20 -right-20" />

      <div className="w-full max-w-md cosmic-surface rounded-3xl p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] text-[#FBF6E9] animate-bounce-in relative z-10 border border-white/10">
        <Link
          to="/"
          className="absolute top-5 left-5 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          title="Back to Home"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>

        <div className="flex flex-col items-center mb-6 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-[#FAC747]/30 text-[#FAC747] flex items-center justify-center mb-3 shadow-[0_0_20px_rgba(250,199,71,0.2)]">
            <ShieldCheck className="w-8 h-8 stroke-[2.5]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-[#FBF6E9] tracking-tight">Admin Portal</h1>
          <p className="text-xs sm:text-sm text-[#FBF6E9]/60 mt-1">Sign in to manage and host your quizzes</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/15 border border-red-500/30 text-red-200 rounded-2xl text-xs font-bold text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#FBF6E9]/70 mb-1.5">
              Username
            </label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3.5 top-3.5 text-white/40" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="cosmic-input w-full pl-11 pr-4 py-3.5 rounded-2xl font-medium text-[#FBF6E9] placeholder:text-white/30"
                placeholder="Enter username"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#FBF6E9]/70 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3.5 top-3.5 text-white/40" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="cosmic-input w-full pl-11 pr-4 py-3.5 rounded-2xl font-medium text-[#FBF6E9] placeholder:text-white/30"
                placeholder="Enter password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-gold w-full py-4 rounded-2xl text-base font-black shadow-lg shadow-amber-500/25 transition-all active:scale-95 disabled:opacity-50 cursor-pointer mt-2"
          >
            {loading ? 'Authenticating...' : 'Sign In as Admin'}
          </button>
        </form>
      </div>
    </div>
  );
};
