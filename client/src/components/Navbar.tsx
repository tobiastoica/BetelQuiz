import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, LogOut, PlusCircle, Gamepad2, LayoutDashboard } from 'lucide-react';
import { logout } from '../utils/api';

interface NavbarProps {
  isAdmin?: boolean;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ isAdmin = false, onLogout }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    if (onLogout) onLogout();
    navigate('/');
  };

  return (
    <header className="w-full bg-[#0F1433]/85 backdrop-blur-xl text-[#FBF6E9] px-6 py-3.5 flex items-center justify-between border-b border-white/10 shadow-lg sticky top-0 z-40">
      <Link to="/" className="flex items-center gap-3 group">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FAC747] to-[#DB941F] text-[#2A1A00] flex items-center justify-center font-black text-base shadow-md shadow-amber-500/25 group-hover:scale-105 transition-transform">
          BQ
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#FBF6E9] font-black text-xl tracking-tight group-hover:text-white transition-colors">
            BetelQuiz
          </span>
          <span className="hidden sm:inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-400/10 text-[#FAC747] border border-[#FAC747]/25 uppercase tracking-wider">
            Pro
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-2.5 sm:gap-3">
        <Link
          to="/play"
          className="flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/5 hover:bg-white/10 text-xs sm:text-sm font-bold text-[#FBF6E9] border border-white/10 transition-all hover:border-white/20 active:scale-95"
        >
          <Gamepad2 className="w-4 h-4 text-[#5CC7B8]" />
          <span>Join Game</span>
        </Link>

        {isAdmin ? (
          <>
            <Link
              to="/admin/dashboard"
              className="flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/5 hover:bg-white/10 text-xs sm:text-sm font-bold text-[#FBF6E9] border border-white/10 transition-all hover:border-white/20 active:scale-95"
            >
              <LayoutDashboard className="w-4 h-4 text-[#FAC747]" />
              <span>My Quizzes</span>
            </Link>
            <Link
              to="/creator"
              className="btn-gold flex items-center gap-1.5 px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-black transition-all hover:scale-105 active:scale-95"
            >
              <PlusCircle className="w-4 h-4 stroke-[2.5]" />
              <span>Create</span>
            </Link>
            <button
              onClick={handleLogout}
              className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <Link
            to="/admin/login"
            className="flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-xs sm:text-sm font-bold text-[#FAC747] border border-[#FAC747]/30 transition-all hover:scale-105"
          >
            <Sparkles className="w-4 h-4 text-[#FAC747]" />
            <span>Admin Portal</span>
          </Link>
        )}
      </div>
    </header>
  );
};
