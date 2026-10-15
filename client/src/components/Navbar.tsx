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
    <header className="w-full bg-[#33106A] text-white px-6 py-3.5 flex items-center justify-between shadow-md z-30">
      <Link to="/" className="flex items-center gap-2.5 text-2xl font-black tracking-wider group">
        <span className="bg-white text-[#46178F] px-2.5 py-0.5 rounded-xl font-black text-2xl group-hover:scale-105 transition-transform shadow">
          BQ
        </span>
        <span className="text-white drop-shadow font-black tracking-tight">BetelQuiz</span>
      </Link>

      <div className="flex items-center gap-3">
        <Link
          to="/play"
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-bold text-white transition-all"
        >
          <Gamepad2 className="w-4 h-4" />
          <span>Join Game</span>
        </Link>

        {isAdmin ? (
          <>
            <Link
              to="/admin/dashboard"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-bold text-white transition-all"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>My Quizzes</span>
            </Link>
            <Link
              to="/creator"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#26890C] hover:bg-[#1e6e09] text-sm font-bold text-white shadow transition-all hover:scale-105"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Create</span>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 text-sm font-medium transition-colors"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <Link
            to="/admin/login"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-sm font-bold text-white transition-all"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>Admin</span>
          </Link>
        )}
      </div>
    </header>
  );
};
