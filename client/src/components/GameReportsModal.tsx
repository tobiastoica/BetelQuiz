import React, { useEffect, useState } from 'react';
import {
  X,
  FileSpreadsheet,
  Download,
  Trash2,
  Trophy,
  Zap,
  AlertTriangle,
  Calendar,
  Users,
  ChevronRight,
  Search,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Check,
  Medal,
  Target,
  Flame,
  History,
  Clock,
} from 'lucide-react';
import type { GameReport, PlayerAnalyticsSummary } from '../types/quiz';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface GameReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GameReportsModal: React.FC<GameReportsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'REPORTS' | 'PLAYERS'>('REPORTS');

  // Reports state
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<GameReport | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Players state
  const [playersList, setPlayersList] = useState<PlayerAnalyticsSummary[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [playerSortBy, setPlayerSortBy] = useState<'wins' | 'avgScore' | 'games' | 'accuracy'>('wins');
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const res = await fetch('/api/reports');
      const data = await res.json();
      if (data.success && Array.isArray(data.reports)) {
        setReportsList(data.reports);
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoadingReports(false);
    }
  };

  const fetchPlayers = async () => {
    setLoadingPlayers(true);
    try {
      const res = await fetch('/api/reports/players');
      const data = await res.json();
      if (data.success && Array.isArray(data.players)) {
        setPlayersList(data.players);
      }
    } catch (err) {
      console.error('Failed to load players analytics:', err);
    } finally {
      setLoadingPlayers(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchReports();
      fetchPlayers();
      setSelectedReportId(null);
      setSelectedReport(null);
    }
  }, [isOpen]);

  useEscapeKey(onClose, isOpen);

  const handleSelectReport = async (reportId: string) => {
    setSelectedReportId(reportId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
      const data = await res.json();
      if (data.success && data.report) {
        setSelectedReport(data.report);
      }
    } catch (err) {
      console.error('Failed to load report detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setReportsList((prev) => prev.filter((r) => r.reportId !== reportId));
        if (selectedReportId === reportId) {
          setSelectedReportId(null);
          setSelectedReport(null);
        }
        // Refresh player stats in case report affected totals
        fetchPlayers();
      }
    } catch (err) {
      console.error('Failed to delete report:', err);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleExportCsv = (reportId: string) => {
    window.open(`/api/reports/${encodeURIComponent(reportId)}/export`, '_blank');
  };

  const handleExportJson = (report: GameReport) => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${report.gameId || report.reportId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyUuid = (uuid: string) => {
    navigator.clipboard.writeText(uuid);
    setCopiedUuid(uuid);
    setTimeout(() => setCopiedUuid(null), 2000);
  };

  if (!isOpen) return null;

  // Filtered reports
  const filteredReports = reportsList.filter(
    (r) =>
      (r.quizTitle || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.pin || '').includes(searchQuery)
  );

  // Filtered & sorted players
  const filteredPlayers = playersList
    .filter((p) => {
      const q = playerSearchQuery.toLowerCase().trim();
      if (!q) return true;
      const matchUuid = (p.userUuid || '').toLowerCase().includes(q);
      const matchNick = (p.currentNickname || '').toLowerCase().includes(q);
      const matchHistory = (p.nicknames || []).some((n) => n.toLowerCase().includes(q));
      return matchUuid || matchNick || matchHistory;
    })
    .sort((a, b) => {
      if (playerSortBy === 'wins') {
        if (b.firstPlaceCount !== a.firstPlaceCount) return b.firstPlaceCount - a.firstPlaceCount;
        return b.averageScore - a.averageScore;
      }
      if (playerSortBy === 'avgScore') {
        if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
        return b.firstPlaceCount - a.firstPlaceCount;
      }
      if (playerSortBy === 'games') {
        return b.gamesPlayed - a.gamesPlayed;
      }
      if (playerSortBy === 'accuracy') {
        return b.accuracyPercentage - a.accuracyPercentage;
      }
      return 0;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Game Reports and Player Analytics"
        className="relative w-full max-w-5xl bg-[#0F1433]/98 border border-white/15 rounded-3xl shadow-[0_24px_64px_rgba(0,0,0,0.6)] backdrop-blur-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Modal Top Header */}
        <div className="p-4 sm:p-6 bg-[#0B0E24]/95 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {selectedReportId ? (
              <button
                onClick={() => {
                  setSelectedReportId(null);
                  setSelectedReport(null);
                }}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#FBF6E9] transition flex items-center gap-1.5 text-xs font-bold border border-white/10"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            ) : (
              <div className="p-2.5 bg-[#FAC747]/10 border border-[#FAC747]/30 rounded-2xl text-[#FAC747] shadow-[0_0_16px_rgba(250,199,71,0.2)]">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
            )}
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-[#FBF6E9]">
                {selectedReport ? selectedReport.quizTitle : 'Game Reports & Analytics Archive'}
              </h2>
              <p className="text-xs text-white/60">
                {selectedReport
                  ? `Game PIN ${selectedReport.pin} • Completed ${new Date(
                      selectedReport.finishedAt
                    ).toLocaleString()}`
                  : 'Historical session analytics and persistent player careers'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {selectedReport && (
              <>
                <button
                  onClick={() => handleExportCsv(selectedReport.reportId)}
                  className="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow"
                  title="Export to CSV spreadsheet"
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
                <button
                  onClick={() => handleExportJson(selectedReport)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-[#FBF6E9] border border-white/15 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                  title="Download JSON report"
                >
                  JSON
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation (Only shown when not drilling into report detail) */}
        {!selectedReportId && (
          <div className="px-6 pt-3 bg-[#0B0E24]/60 border-b border-white/10 flex items-center gap-3">
            <button
              onClick={() => setActiveTab('REPORTS')}
              className={`pb-3 px-3 text-xs sm:text-sm font-black flex items-center gap-2 border-b-2 transition ${
                activeTab === 'REPORTS'
                  ? 'border-[#FAC747] text-[#FAC747]'
                  : 'border-transparent text-white/60 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Game Sessions</span>
              <span className="px-2 py-0.5 rounded-full bg-[#FAC747]/15 text-[#FAC747] text-[10px] font-bold">
                {reportsList.length}
              </span>
            </button>

            <button
              onClick={() => {
                setActiveTab('PLAYERS');
                if (playersList.length === 0) fetchPlayers();
              }}
              className={`pb-3 px-3 text-xs sm:text-sm font-black flex items-center gap-2 border-b-2 transition ${
                activeTab === 'PLAYERS'
                  ? 'border-[#FAC747] text-[#FAC747]'
                  : 'border-transparent text-white/60 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>All Players Archive</span>
              <span className="px-2 py-0.5 rounded-full bg-[#7FE0D2]/15 text-[#7FE0D2] text-[10px] font-bold">
                {playersList.length}
              </span>
            </button>
          </div>
        )}

        {/* Modal Main Content Container with GPU accelerated scrolling */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 overscroll-contain will-change-scroll transform-gpu">
          {/* ================================================================= */}
          {/* TAB 1: REPORTS LIST OR DETAIL VIEW */}
          {/* ================================================================= */}
          {activeTab === 'REPORTS' && (
            <div>
              {!selectedReportId ? (
                /* REPORTS LIST VIEW */
                <div className="space-y-4">
                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter by quiz title or game PIN..."
                      className="w-full pl-11 pr-4 py-2.5 bg-[#131938]/90 border border-white/10 rounded-2xl text-[#FBF6E9] text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FAC747] transition"
                    />
                  </div>

                  {loadingReports ? (
                    <div className="flex items-center justify-center py-16 text-white/50 text-sm">
                      <div className="w-6 h-6 border-3 border-[#FAC747] border-t-transparent rounded-full animate-spin mr-3" />
                      Loading archives...
                    </div>
                  ) : filteredReports.length === 0 ? (
                    <div className="p-12 text-center text-white/40 bg-[#131938]/40 rounded-3xl border border-white/5">
                      <FileSpreadsheet className="w-12 h-12 mx-auto text-white/30 mb-3 opacity-50" />
                      <p className="font-bold text-base text-[#FBF6E9]">No game reports found</p>
                      <p className="text-xs text-white/50 mt-1">
                        Finish a live quiz session to the podium to archive analytics!
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {filteredReports.map((rep) => (
                        <div
                          key={rep.reportId}
                          className="p-4 sm:p-5 bg-[#131938]/80 hover:bg-[#182046] border border-white/10 hover:border-[#FAC747]/40 rounded-2xl transition duration-200 flex items-center justify-between group shadow-sm hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                        >
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => handleSelectReport(rep.reportId)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs px-2.5 py-0.5 rounded-lg bg-[#FAC747]/15 text-[#FAC747] border border-[#FAC747]/30 font-bold">
                                PIN: {rep.pin}
                              </span>
                              <span className="text-xs text-white/50 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                {new Date(rep.finishedAt).toLocaleDateString()} at{' '}
                                {new Date(rep.finishedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>

                            <h3 className="text-lg font-black text-[#FBF6E9] mt-1 group-hover:text-[#FAC747] transition">
                              {rep.quizTitle}
                            </h3>

                            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-white/60">
                              <span className="flex items-center gap-1">
                                <Users className="w-3.5 h-3.5 text-white/40" />
                                {rep.totalPlayers} Players
                              </span>
                              {rep.winner && (
                                <span className="flex items-center gap-1 text-[#FAC747] font-bold">
                                  <Trophy className="w-3.5 h-3.5 text-[#FAC747]" />
                                  Winner: {rep.winner.nickname} ({rep.winner.score?.toLocaleString?.() ?? rep.winner.score ?? 0} pts)
                                </span>
                              )}
                              {rep.speedChampion && (
                                <span className="flex items-center gap-1 text-[#7FE0D2]">
                                  <Zap className="w-3.5 h-3.5 text-[#7FE0D2]" />
                                  Fastest: {rep.speedChampion.nickname}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 ml-4">
                            <button
                              onClick={() => handleExportCsv(rep.reportId)}
                              className="p-2 rounded-xl bg-white/5 hover:bg-emerald-600/30 text-white/50 hover:text-emerald-300 border border-white/5 transition"
                              title="Download CSV"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            {deleteConfirmId === rep.reportId ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDeleteReport(rep.reportId)}
                                  className="px-2.5 py-1.5 rounded-xl bg-rose-600 text-white font-bold text-xs"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="px-2.5 py-1.5 rounded-xl bg-white/10 text-white font-bold text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(rep.reportId)}
                                className="p-2 rounded-xl bg-white/5 hover:bg-rose-600/30 text-white/50 hover:text-rose-400 border border-white/5 transition"
                                title="Delete report"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleSelectReport(rep.reportId)}
                              className="p-2 rounded-xl bg-[#FAC747]/15 hover:bg-[#FAC747] text-[#FAC747] hover:text-[#2A1A00] border border-[#FAC747]/30 transition font-bold"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* REPORT DETAIL VIEW */
                <div>
                  {loadingDetail || !selectedReport ? (
                    <div className="flex items-center justify-center py-20 text-white/50">
                      <div className="w-8 h-8 border-4 border-[#FAC747] border-t-transparent rounded-full animate-spin mr-3" />
                      Generating detailed analytics...
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-4 bg-[#131938]/80 border border-white/10 rounded-2xl">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                            Total Players
                          </span>
                          <div className="text-2xl font-black text-[#FBF6E9] mt-1">
                            {selectedReport.totalPlayers}
                          </div>
                        </div>
                        <div className="p-4 bg-[#131938]/80 border border-white/10 rounded-2xl">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                            Questions
                          </span>
                          <div className="text-2xl font-black text-[#FBF6E9] mt-1">
                            {selectedReport.totalQuestions}
                          </div>
                        </div>
                        <div className="p-4 bg-[#131938]/80 border border-white/10 rounded-2xl">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                            Duration
                          </span>
                          <div className="text-2xl font-black text-[#FBF6E9] mt-1">
                            {Math.floor(selectedReport.durationSeconds / 60)}m{' '}
                            {selectedReport.durationSeconds % 60}s
                          </div>
                        </div>
                        <div className="p-4 bg-gradient-to-br from-[#FAC747]/15 to-[#DB941F]/25 border border-[#FAC747]/40 rounded-2xl">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-[#FAC747]">
                            Champion
                          </span>
                          <div className="text-xl font-black text-[#FBF6E9] mt-1 truncate">
                            {selectedReport.podium.first?.nickname || 'None'}
                          </div>
                        </div>
                      </div>

                      {/* Highlights */}
                      <div className="grid sm:grid-cols-2 gap-4">
                        {selectedReport.speedChampion && (
                          <div className="p-4 bg-[#7FE0D2]/10 border border-[#7FE0D2]/30 rounded-2xl flex items-center gap-3">
                            <div className="p-3 bg-[#7FE0D2]/20 text-[#7FE0D2] rounded-xl">
                              <Zap className="w-6 h-6" />
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-wider text-[#7FE0D2] font-bold">
                                Speed Champion
                              </div>
                              <div className="text-base font-black text-[#FBF6E9]">
                                {selectedReport.speedChampion.nickname}
                              </div>
                              <div className="text-xs text-white/60">
                                Avg correct response:{' '}
                                {(selectedReport.speedChampion.averageResponseTimeMs / 1000).toFixed(2)}
                                s
                              </div>
                            </div>
                          </div>
                        )}

                        {selectedReport.toughestQuestion && (
                          <div className="p-4 bg-rose-950/40 border border-rose-500/30 rounded-2xl flex items-center gap-3">
                            <div className="p-3 bg-rose-500/20 text-rose-400 rounded-xl">
                              <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-wider text-rose-300 font-bold">
                                Toughest Question (Q{selectedReport.toughestQuestion.questionIndex})
                              </div>
                              <div className="text-base font-black text-[#FBF6E9] truncate max-w-xs">
                                {selectedReport.toughestQuestion.title}
                              </div>
                              <div className="text-xs text-white/60">
                                Accuracy rate: {selectedReport.toughestQuestion.accuracyRate}%
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Leaderboard Table */}
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-widest text-white/60 mb-3 flex items-center gap-1.5">
                          <Trophy className="w-4 h-4 text-[#FAC747]" /> Final Podium & Leaderboard
                        </h3>
                        <div className="bg-[#131938]/80 border border-white/10 rounded-2xl overflow-hidden">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-[#0B0E24]/80 text-xs text-white/50 uppercase tracking-wider border-b border-white/5">
                              <tr>
                                <th className="p-3.5">Rank</th>
                                <th className="p-3.5">Player</th>
                                <th className="p-3.5">Score</th>
                                <th className="p-3.5">Streak</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {selectedReport.leaderboard.map((player) => (
                                <tr key={player.userUuid} className="hover:bg-white/5 transition">
                                  <td className="p-3.5 font-black">
                                    {player.rank === 1 ? (
                                      <span className="px-2 py-0.5 rounded-lg bg-gradient-to-r from-[#FAC747] to-[#DB941F] text-[#2A1A00] text-xs font-black shadow-sm">
                                        🥇 1st
                                      </span>
                                    ) : player.rank === 2 ? (
                                      <span className="px-2 py-0.5 rounded-lg bg-slate-300 text-slate-950 text-xs font-black">
                                        🥈 2nd
                                      </span>
                                    ) : player.rank === 3 ? (
                                      <span className="px-2 py-0.5 rounded-lg bg-amber-700 text-white text-xs font-black">
                                        🥉 3rd
                                      </span>
                                    ) : (
                                      <span className="text-white/60">#{player.rank}</span>
                                    )}
                                  </td>
                                  <td className="p-3.5 font-bold text-[#FBF6E9] flex items-center gap-2">
                                    <span>{player.avatar}</span>
                                    <span>{player.nickname}</span>
                                  </td>
                                  <td className="p-3.5 font-black text-[#FAC747]">
                                    {player.score?.toLocaleString?.() ?? 0}
                                  </td>
                                  <td className="p-3.5 font-semibold text-rose-400">
                                    {player.streak ?? 0}🔥
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Question Breakdown */}
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-widest text-white/60 mb-3 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Question Breakdown
                        </h3>
                        <div className="space-y-3">
                          {selectedReport.questionAnalytics.map((q) => (
                            <div
                              key={q.questionIndex}
                              className="p-4 bg-[#131938]/80 border border-white/5 rounded-2xl"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono font-bold px-2 py-0.5 bg-[#FAC747]/15 text-[#FAC747] border border-[#FAC747]/30 rounded-md">
                                    Q{q.questionIndex}
                                  </span>
                                  <span className="text-xs uppercase font-bold text-white/50">
                                    {q.type}
                                  </span>
                                </div>
                                <span className="text-xs font-black text-emerald-400">
                                  {q.accuracyRate}% Accuracy
                                </span>
                              </div>

                              <h4 className="font-bold text-[#FBF6E9] text-base mt-1.5">{q.title}</h4>

                              <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs">
                                <div className="p-2 bg-[#0B0E24]/80 rounded-xl text-center border border-white/5">
                                  <span className="text-white/50 block text-[10px]">Correct</span>
                                  <span className="font-bold text-emerald-400">{q.correctCount}</span>
                                </div>
                                <div className="p-2 bg-[#0B0E24]/80 rounded-xl text-center border border-white/5">
                                  <span className="text-white/50 block text-[10px]">Wrong</span>
                                  <span className="font-bold text-rose-400">{q.wrongCount}</span>
                                </div>
                                <div className="p-2 bg-[#0B0E24]/80 rounded-xl text-center border border-white/5">
                                  <span className="text-white/50 block text-[10px]">Avg Time</span>
                                  <span className="font-bold text-[#7FE0D2]">
                                    {(q.averageResponseTimeMs / 1000).toFixed(1)}s
                                  </span>
                                </div>
                                <div className="p-2 bg-[#0B0E24]/80 rounded-xl text-center border border-white/5 col-span-3 sm:col-span-1">
                                  <span className="text-white/50 block text-[10px]">Fastest</span>
                                  <span className="font-bold text-[#FAC747] truncate block">
                                    {q.fastestSolver ? q.fastestSolver.nickname : 'None'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: ALL PLAYERS ARCHIVE (BY ID, NICKNAMES OVER TIME, PODIUMS) */}
          {/* ================================================================= */}
          {activeTab === 'PLAYERS' && (
            <div className="space-y-4">
              {/* Controls bar: Search & Sorting */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    value={playerSearchQuery}
                    onChange={(e) => setPlayerSearchQuery(e.target.value)}
                    placeholder="Search by player ID, current nickname, or past nicknames..."
                    className="w-full pl-11 pr-4 py-2.5 bg-[#131938]/90 border border-white/10 rounded-2xl text-[#FBF6E9] text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FAC747] transition"
                  />
                </div>

                <div className="flex items-center gap-1.5 bg-[#131938]/80 p-1.5 rounded-2xl border border-white/10 shrink-0 text-xs">
                  <span className="text-white/50 font-bold px-2 hidden sm:inline">Sort by:</span>
                  <button
                    onClick={() => setPlayerSortBy('wins')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 ${
                      playerSortBy === 'wins'
                        ? 'bg-gradient-to-r from-[#FAC747] to-[#DB941F] text-[#2A1A00] shadow-[0_4px_16px_rgba(250,199,71,0.25)]'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    🥇 Wins
                  </button>
                  <button
                    onClick={() => setPlayerSortBy('avgScore')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 ${
                      playerSortBy === 'avgScore'
                        ? 'bg-gradient-to-r from-[#FAC747] to-[#DB941F] text-[#2A1A00] shadow-[0_4px_16px_rgba(250,199,71,0.25)]'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    🎯 Avg Score
                  </button>
                  <button
                    onClick={() => setPlayerSortBy('games')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition ${
                      playerSortBy === 'games'
                        ? 'bg-gradient-to-r from-[#FAC747] to-[#DB941F] text-[#2A1A00] shadow-[0_4px_16px_rgba(250,199,71,0.25)]'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    🎮 Games
                  </button>
                  <button
                    onClick={() => setPlayerSortBy('accuracy')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition ${
                      playerSortBy === 'accuracy'
                        ? 'bg-gradient-to-r from-[#7FE0D2] to-[#2F8F84] text-[#06231F] shadow-[0_4px_16px_rgba(127,224,210,0.25)]'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    ⚡ Accuracy
                  </button>
                </div>
              </div>

              {loadingPlayers ? (
                <div className="flex items-center justify-center py-16 text-white/50 text-sm">
                  <div className="w-6 h-6 border-3 border-[#FAC747] border-t-transparent rounded-full animate-spin mr-3" />
                  Loading player career archives...
                </div>
              ) : filteredPlayers.length === 0 ? (
                <div className="p-12 text-center text-white/40 bg-[#131938]/40 rounded-3xl border border-white/5">
                  <Users className="w-12 h-12 mx-auto text-white/30 mb-3 opacity-50" />
                  <p className="font-bold text-base text-[#FBF6E9]">No players found</p>
                  <p className="text-xs text-white/50 mt-1">
                    Play a live quiz session with connected players to build career records!
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {filteredPlayers.map((player, idx) => (
                    <div
                      key={player.userUuid}
                      className="p-4 sm:p-5 bg-[#131938]/80 hover:bg-[#182046] border border-white/10 hover:border-[#FAC747]/40 rounded-2xl transition duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
                    >
                      {/* Left: Identity, Avatar & Nicknames Over Time */}
                      <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#FAC747]/15 border border-[#FAC747]/30 flex items-center justify-center text-2xl sm:text-3xl shadow">
                            {player.avatar || '🦊'}
                          </div>
                          {idx === 0 && playerSortBy === 'wins' && player.firstPlaceCount > 0 && (
                            <span className="absolute -top-2 -right-1 text-sm drop-shadow" title="Top Champion">
                              👑
                            </span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-black text-[#FBF6E9] truncate">
                              {player.currentNickname}
                            </h3>
                            {player.firstPlaceCount > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-[#FAC747]/15 text-[#FAC747] border border-[#FAC747]/30 text-[10px] font-black">
                                🏆 {player.firstPlaceCount} {player.firstPlaceCount === 1 ? 'Victory' : 'Victories'}
                              </span>
                            )}
                          </div>

                          {/* ID with Click to Copy */}
                          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-white/40 font-mono">
                            <span>ID:</span>
                            <span className="text-white/60 font-bold">
                              {player.userUuid.slice(0, 14)}...
                            </span>
                            <button
                              onClick={() => handleCopyUuid(player.userUuid)}
                              className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition"
                              title="Copy full device UUID"
                            >
                              {copiedUuid === player.userUuid ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {copiedUuid === player.userUuid && (
                              <span className="text-[10px] text-emerald-400 font-sans font-bold">Copied!</span>
                            )}
                          </div>

                          {/* Nicknames Over Time */}
                          {player.nicknames && player.nicknames.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              <span className="text-[11px] text-white/50 flex items-center gap-1 font-semibold">
                                <History className="w-3 h-3 text-[#FAC747]" /> Nicknames:
                              </span>
                              {player.nicknames.map((nick, nIdx) => (
                                <span
                                  key={nIdx}
                                  className={`text-[11px] px-2 py-0.5 rounded-lg font-bold border ${
                                    nick === player.currentNickname
                                      ? 'bg-[#FAC747]/15 text-[#FAC747] border-[#FAC747]/30'
                                      : 'bg-white/5 text-white/70 border-white/10'
                                  }`}
                                >
                                  {nick}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Stats (Average Score, 1st/2nd/3rd, Games) */}
                      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-white/5 shrink-0">
                        {/* Average Score */}
                        <div className="px-3.5 py-2 bg-[#0B0E24]/80 rounded-xl border border-white/5 text-center min-w-[90px]">
                          <span className="text-[10px] uppercase font-bold text-white/40 block">
                            Avg Score
                          </span>
                          <span className="text-base font-black text-[#FAC747] font-mono">
                            {player.averageScore.toLocaleString()}
                          </span>
                        </div>

                        {/* Podium Counts */}
                        <div className="flex items-center gap-1 px-3 py-2 bg-[#0B0E24]/80 rounded-xl border border-white/5">
                          <div className="text-center px-1.5" title="1st Place Finishes">
                            <span className="text-[10px] text-[#FAC747] block font-bold">🥇 1st</span>
                            <span className="text-sm font-black text-[#FBF6E9]">{player.firstPlaceCount}</span>
                          </div>
                          <div className="w-px h-6 bg-white/10" />
                          <div className="text-center px-1.5" title="2nd Place Finishes">
                            <span className="text-[10px] text-slate-300 block font-bold">🥈 2nd</span>
                            <span className="text-sm font-black text-[#FBF6E9]">{player.secondPlaceCount}</span>
                          </div>
                          <div className="w-px h-6 bg-white/10" />
                          <div className="text-center px-1.5" title="3rd Place Finishes">
                            <span className="text-[10px] text-amber-700 block font-bold">🥉 3rd</span>
                            <span className="text-sm font-black text-[#FBF6E9]">{player.thirdPlaceCount}</span>
                          </div>
                        </div>

                        {/* Games & Accuracy */}
                        <div className="px-3.5 py-2 bg-[#0B0E24]/80 rounded-xl border border-white/5 text-right min-w-[90px]">
                          <div className="text-xs text-[#FBF6E9] font-bold">
                            {player.gamesPlayed} {player.gamesPlayed === 1 ? 'game' : 'games'}
                          </div>
                          <div className="text-[11px] text-[#7FE0D2] font-semibold">
                            {player.accuracyPercentage}% accuracy
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
