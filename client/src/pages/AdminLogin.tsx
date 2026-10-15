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
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#33106A] text-white p-6">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-2xl text-slate-800 animate-bounce-in relative">
        <Link
          to="/"
          className="absolute top-5 left-5 text-slate-400 hover:text-slate-600 transition-colors"
          title="Back to Home"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>

        <div className="flex flex-col items-center mb-6 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-[#46178F] text-white flex items-center justify-center mb-3 shadow-lg">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-slate-900">Admin Portal</h1>
          <p className="text-sm text-slate-500">Sign in to manage and host your quizzes</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-semibold text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Username
            </label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-300 focus:border-[#46178F] focus:outline-none font-medium text-slate-800 transition-colors"
                placeholder="Enter username"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-300 focus:border-[#46178F] focus:outline-none font-medium text-slate-800 transition-colors"
                placeholder="Enter password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-[#46178F] hover:bg-[#33106A] text-white font-black text-base shadow-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Authenticating...' : 'Sign In as Admin'}
          </button>
        </form>
      </div>
    </div>
  );
};
