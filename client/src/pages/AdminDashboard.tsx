import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { fetchQuizzes, deleteQuiz, duplicateQuiz, checkAuth } from '../utils/api';
import { getSocket } from '../utils/socket';
import type { Quiz } from '../types/quiz';
import {
  Play,
  Plus,
  Edit3,
  Copy,
  Trash2,
  HelpCircle,
  Layers,
  Calendar,
  FileSpreadsheet,
  Download,
  Upload,
} from 'lucide-react';
import { GameReportsModal } from '../components/GameReportsModal';

export const AdminDashboard: React.FC = () => {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostingQuizId, setHostingQuizId] = useState<string | null>(null);
  const [showReportsModal, setShowReportsModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const kahootFileRef = useRef<HTMLInputElement>(null);
  const betelquizFileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const loadQuizzes = async () => {
    try {
      const list = await fetchQuizzes();
      setQuizzes(list);
    } catch (err) {
      console.error('Failed to load quizzes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    checkAuth().then((res) => {
      if (!isMounted) return;
      if (!res.authenticated) {
        navigate('/admin/login');
      } else {
        loadQuizzes();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleKahootCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch('/api/quizzes/import/kahoot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: text, title: file.name.replace(/\.[^/.]+$/, '') }),
      });
      const data = await res.json();
      if (data.success) {
        loadQuizzes();
        alert('Kahoot CSV successfully imported!');
      } else {
        alert(data.error || 'Failed to import Kahoot CSV');
      }
    } catch (err: any) {
      alert(err.message || 'Import failed');
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleBetelQuizJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch('/api/quizzes/import/betelquiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonContent: text }),
      });
      const data = await res.json();
      if (data.success) {
        loadQuizzes();
        alert('BetelQuiz JSON successfully imported!');
      } else {
        alert(data.error || 'Failed to import BetelQuiz JSON');
      }
    } catch (err: any) {
      alert(err.message || 'Import failed');
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleHostGame = (quizId: string) => {
    setHostingQuizId(quizId);
    const socket = getSocket();

    socket.emit('host_create_game', { quizId });

    socket.once('game_created', (data) => {
      setHostingQuizId(null);
      if (data.success && data.pin) {
        if (data.hostSecret) {
          sessionStorage.setItem(`kahoot_host_secret_${data.pin}`, data.hostSecret);
        }
        navigate(`/host/${data.pin}`, { state: { hostSecret: data.hostSecret } });
      }
    });

    socket.once('game_error', (data) => {
      setHostingQuizId(null);
      alert(data.error || 'Failed to start game');
    });
  };

  const handleDuplicate = async (quizId: string) => {
    try {
      await duplicateQuiz(quizId);
      loadQuizzes();
    } catch (err: any) {
      alert(err.message || 'Duplicate failed');
    }
  };

  const handleDelete = async (quizId: string, title: string) => {
    if (window.confirm(`Are you sure you want to delete "${title}"?`)) {
      try {
        await deleteQuiz(quizId);
        loadQuizzes();
      } catch (err: any) {
        alert(err.message || 'Delete failed');
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      <Navbar isAdmin={true} />

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">My Quizzes</h1>
            <p className="text-sm text-slate-500 mt-1">
              Create, edit, and launch live quiz games from your local library
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Reports & Analytics Button */}
            <button
              onClick={() => setShowReportsModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-[#46178F] font-bold text-xs border border-indigo-200 shadow-sm transition active:scale-95 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-[#46178F]" />
              <span>Reports & Analytics</span>
            </button>

            {/* Import Kahoot CSV */}
            <button
              onClick={() => kahootFileRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs border border-slate-300 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
              title="Import official Kahoot CSV spreadsheet"
            >
              <Upload className="w-4 h-4 text-emerald-600" />
              <span>Import Kahoot CSV</span>
            </button>
            <input
              ref={kahootFileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleKahootCsvUpload}
            />

            {/* Import BetelQuiz JSON */}
            <button
              onClick={() => betelquizFileRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs border border-slate-300 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
              title="Import full BetelQuiz JSON file"
            >
              <Upload className="w-4 h-4 text-indigo-600" />
              <span>Import JSON</span>
            </button>
            <input
              ref={betelquizFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleBetelQuizJsonUpload}
            />

            <button
              onClick={() => navigate('/creator')}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#26890C] hover:bg-[#1e6e09] text-white font-bold text-sm shadow-md hover:shadow-lg transition-all hover:scale-102 active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Quiz</span>
            </button>
          </div>
        </div>

        {/* Quizzes Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="w-10 h-10 border-4 border-[#46178F] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="font-semibold text-sm">Loading your quizzes...</p>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-200">
            <div className="w-16 h-16 bg-purple-100 text-[#46178F] rounded-full flex items-center justify-center mx-auto mb-4">
              <Layers className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">No quizzes created yet</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
              Create your very first interactive quiz to host live for your players!
            </p>
            <button
              onClick={() => navigate('/creator')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#46178F] hover:bg-[#33106A] text-white font-bold text-sm shadow transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Quiz</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md border border-slate-200 transition-all flex flex-col group"
              >
                {/* Thumbnail / Header Banner */}
                <div className="h-36 bg-gradient-to-br from-[#46178F] to-[#33106A] relative flex items-center justify-center overflow-hidden">
                  {quiz.coverImage ? (
                    <img
                      src={quiz.coverImage}
                      alt={quiz.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-white/40 flex flex-col items-center gap-1">
                      <HelpCircle className="w-10 h-10 stroke-1" />
                      <span className="text-xs font-semibold tracking-wider uppercase">BetelQuiz</span>
                    </div>
                  )}

                  {/* Question count badge */}
                  <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur text-white text-xs font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    <span>{(quiz as any).questionCount ?? quiz.questions?.length ?? 0} Questions</span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h2 className="font-black text-lg text-slate-900 line-clamp-1 group-hover:text-[#46178F] transition-colors">
                      {quiz.title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 h-8">
                      {quiz.description || 'No description provided'}
                    </p>
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-3">
                      <Calendar className="w-3 h-3" />
                      <span>Updated {new Date(quiz.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleHostGame(quiz.id)}
                      disabled={hostingQuizId === quiz.id}
                      className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-[#46178F] hover:bg-[#33106A] text-white font-bold text-xs rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
                      title="Launch live game room"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{hostingQuizId === quiz.id ? 'Starting...' : 'Host Live'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <a
                        href={`/api/quizzes/${quiz.id}/export/kahoot`}
                        download
                        className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Export Kahoot CSV"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                      </a>

                      <a
                        href={`/api/quizzes/${quiz.id}/export/betelquiz`}
                        download
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Export BetelQuiz JSON"
                      >
                        <Download className="w-4 h-4" />
                      </a>

                      <button
                        onClick={() => navigate(`/creator/${quiz.id}`)}
                        className="p-2 text-slate-600 hover:text-[#46178F] hover:bg-purple-50 rounded-lg transition-colors"
                        title="Edit quiz"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDuplicate(quiz.id)}
                        className="p-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Duplicate quiz"
                      >
                        <Copy className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDelete(quiz.id, quiz.title)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete quiz"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reports & Analytics Modal */}
        <GameReportsModal
          isOpen={showReportsModal}
          onClose={() => setShowReportsModal(false)}
        />
      </main>
    </div>
  );
};
