import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { fetchQuizzes, deleteQuiz, duplicateQuiz, checkAuth, createGame } from '../utils/api';
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

  const handleHostGame = async (quizId: string) => {
    if (hostingQuizId) return;
    setHostingQuizId(quizId);
    try {
      const data = await createGame(quizId);
      if (data.pin) {
        if (data.hostSecret) {
          localStorage.setItem(`kahoot_host_secret_${data.pin}`, data.hostSecret);
        }
        navigate(`/host/${data.pin}`, { state: { hostSecret: data.hostSecret } });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to start game');
    } finally {
      setHostingQuizId(null);
    }
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
    <div className="min-h-screen flex flex-col cosmic-canvas text-[#FBF6E9]">
      <Navbar isAdmin={true} />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Top Header & Quick Action Ribbon */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 mb-8">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-3xl sm:text-4xl font-black text-[#FBF6E9] tracking-tight">
                My Quizzes
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-400/10 text-[#FAC747] border border-[#FAC747]/25 text-xs font-black">
                {quizzes.length} Library
              </span>
            </div>
            <p className="text-sm text-[#FBF6E9]/60 mt-1">
              Create, edit, and launch live quiz games from your personal library
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Reports & Analytics Button */}
            <button
              onClick={() => setShowReportsModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-[#5CC7B8] font-bold text-xs border border-[#5CC7B8]/30 shadow-sm transition active:scale-95 cursor-pointer backdrop-blur-md"
            >
              <FileSpreadsheet className="w-4 h-4 text-[#5CC7B8]" />
              <span>Reports & Analytics</span>
            </button>

            {/* Import Kahoot CSV */}
            <button
              onClick={() => kahootFileRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-[#FBF6E9] font-bold text-xs border border-white/10 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50 backdrop-blur-md"
              title="Import official Kahoot CSV spreadsheet"
            >
              <Upload className="w-3.5 h-3.5 text-[#5CC7B8]" />
              <span>Import CSV</span>
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
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-[#FBF6E9] font-bold text-xs border border-white/10 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50 backdrop-blur-md"
              title="Import full BetelQuiz JSON file"
            >
              <Upload className="w-3.5 h-3.5 text-indigo-400" />
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
              className="btn-gold flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-black shadow-lg shadow-amber-500/25 hover:scale-105 active:scale-95 cursor-pointer transition-all"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Create Quiz</span>
            </button>
          </div>
        </div>

        {/* Quizzes Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-[#FBF6E9]/40">
            <div className="w-12 h-12 border-4 border-[#FAC747] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="font-semibold text-sm">Loading your quizzes...</p>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="cosmic-surface rounded-3xl p-12 text-center max-w-lg mx-auto">
            <div className="w-16 h-16 bg-amber-400/10 text-[#FAC747] rounded-2xl border border-[#FAC747]/20 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/10">
              <Layers className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-black text-[#FBF6E9] mb-2">No quizzes created yet</h3>
            <p className="text-sm text-[#FBF6E9]/60 max-w-md mx-auto mb-6">
              Create your very first interactive quiz to host live for your players!
            </p>
            <button
              onClick={() => navigate('/creator')}
              className="btn-gold inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-black shadow-lg shadow-amber-500/25 transition-all hover:scale-105"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Create New Quiz</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="bg-[#0F1433]/70 hover:bg-[#161D48]/80 backdrop-blur-xl rounded-3xl overflow-hidden border border-white/10 hover:border-[#FAC747]/45 shadow-xl hover:shadow-[0_12px_40px_-14px_rgba(250,199,71,0.3)] transition-all duration-300 flex flex-col group hover:-translate-y-1"
              >
                {/* Thumbnail / Header Banner */}
                <div className="h-40 bg-gradient-to-br from-[#1F2A6A] via-[#161D48] to-[#0F1433] relative flex items-center justify-center overflow-hidden border-b border-white/10">
                  {quiz.coverImage ? (
                    <img
                      src={quiz.coverImage}
                      alt={quiz.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="text-white/30 flex flex-col items-center gap-1.5 group-hover:scale-110 transition-transform duration-300">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-inner">
                        <HelpCircle className="w-6 h-6 stroke-[1.5] text-[#FAC747]" />
                      </div>
                      <span className="text-[11px] font-black tracking-widest uppercase text-[#FBF6E9]/50">
                        BetelQuiz
                      </span>
                    </div>
                  )}

                  {/* Question count badge */}
                  <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md text-[#FBF6E9] text-xs font-bold px-3 py-1 rounded-full border border-white/15 flex items-center gap-1.5 shadow-md">
                    <Layers className="w-3.5 h-3.5 text-[#5CC7B8]" />
                    <span>{quiz.questionCount ?? quiz.questions?.length ?? 0} Questions</span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h2 className="font-black text-lg text-[#FBF6E9] line-clamp-1 group-hover:text-[#FAC747] transition-colors">
                      {quiz.title}
                    </h2>
                    <p className="text-xs text-[#FBF6E9]/60 mt-1.5 line-clamp-2 h-8 leading-relaxed">
                      {quiz.description || 'No description provided'}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#FBF6E9]/40 mt-3 font-medium">
                      <Calendar className="w-3 h-3 text-[#5CC7B8]" />
                      <span>Updated {new Date(quiz.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleHostGame(quiz.id)}
                      disabled={hostingQuizId === quiz.id}
                      className="btn-gold flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-full text-xs font-black shadow-md shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                      title="Launch live game room"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{hostingQuizId === quiz.id ? 'Starting...' : 'Host Live'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <a
                        href={`/api/quizzes/${quiz.id}/export/kahoot`}
                        download
                        className="p-2 text-white/40 hover:text-[#5CC7B8] hover:bg-[#5CC7B8]/10 rounded-xl transition-all"
                        title="Export Kahoot CSV"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                      </a>

                      <a
                        href={`/api/quizzes/${quiz.id}/export/betelquiz`}
                        download
                        className="p-2 text-white/40 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-all"
                        title="Export BetelQuiz JSON"
                      >
                        <Download className="w-4 h-4" />
                      </a>

                      <button
                        onClick={() => navigate(`/creator/${quiz.id}`)}
                        className="p-2 text-white/40 hover:text-[#FAC747] hover:bg-amber-400/10 rounded-xl transition-all cursor-pointer"
                        title="Edit quiz"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDuplicate(quiz.id)}
                        className="p-2 text-white/40 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-xl transition-all cursor-pointer"
                        title="Duplicate quiz"
                      >
                        <Copy className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleDelete(quiz.id, quiz.title)}
                        className="p-2 text-white/40 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer"
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
