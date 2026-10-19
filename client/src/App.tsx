import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Play } from './pages/Play';
import { Host } from './pages/Host';
import { Creator } from './pages/Creator';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Play />} />
        <Route path="/play" element={<Play />} />
        <Route path="/play/:gamePinParam" element={<Play />} />
        <Route path="/host/:pin" element={<Host />} />
        <Route path="/creator" element={<Creator />} />
        <Route path="/creator/:quizId" element={<Creator />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
