import express from 'express';
import { requireAdmin } from './auth.js';
import {
  listGameReports,
  getGameReport,
  deleteGameReport,
  exportReportToCsv,
} from '../reportsManager.js';
import { getAllPlayersAnalytics } from '../playerProfiles.js';

const router = express.Router();

// List all reports
router.get('/', requireAdmin, (req, res) => {
  try {
    const reports = listGameReports();
    res.json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list reports' });
  }
});

// List all players analytics
router.get('/players', requireAdmin, (req, res) => {
  try {
    const players = getAllPlayersAnalytics();
    res.json({ success: true, players });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list players' });
  }
});

// Get single full report
router.get('/:id', requireAdmin, (req, res) => {
  try {
    const report = getGameReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get report' });
  }
});

// Export report as CSV spreadsheet
router.get('/:id/export', requireAdmin, (req, res) => {
  try {
    const csvData = exportReportToCsv(req.params.id);
    if (!csvData) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report_${req.params.id}.csv"`);
    res.send(csvData);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to export report' });
  }
});

// Delete a report
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const success = deleteGameReport(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete report' });
  }
});

export default router;
