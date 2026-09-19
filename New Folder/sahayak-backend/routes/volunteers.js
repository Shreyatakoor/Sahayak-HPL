const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireFields, missingFieldsResponse } = require('../utils/validators');

const router = express.Router();

/**
 * GET /api/volunteers
 * police_admin only. Optional ?status=under_review filter.
 */
router.get('/', authenticateToken, requireRole('police_admin'), (req, res) => {
  const { status } = req.query;
  const sql = status
    ? `SELECT * FROM volunteers WHERE status = ? ORDER BY created_at DESC`
    : `SELECT * FROM volunteers ORDER BY created_at DESC`;
  const params = status ? [status] : [];

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    res.json({ success: true, data: rows });
  });
});

/**
 * GET /api/volunteers/:id
 * police_admin or the volunteer themself.
 */
router.get('/:id', authenticateToken, (req, res) => {
  db.get(`SELECT * FROM volunteers WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Volunteer not found' } });

    if (req.user.role !== 'police_admin' && req.user.id !== row.user_id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to view this record' } });
    }
    res.json({ success: true, data: row });
  });
});

/**
 * PATCH /api/volunteers/:id/review
 * police_admin only. Moves a volunteer to under_review and records a verification_record.
 * body: { notes }
 */
router.patch('/:id/review', authenticateToken, requireRole('police_admin'), (req, res) => {
  const { notes } = req.body;
  const recordId = 'ver-' + Date.now();

  db.run(`UPDATE volunteers SET status = 'under_review' WHERE id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (this.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Volunteer not found' } });

    db.run(
      `INSERT INTO verification_records (id, volunteer_id, reviewed_by, notes, decision) VALUES (?, ?, ?, ?, 'pending')`,
      [recordId, req.params.id, req.user.id, notes || null],
      (vErr) => {
        if (vErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: vErr.message } });
        res.json({ success: true, data: { volunteer_id: req.params.id, status: 'under_review', verification_record_id: recordId } });
      }
    );
  });
});

/**
 * PATCH /api/volunteers/:id/decision
 * police_admin only. Approves or rejects a volunteer.
 * body: { decision: 'approved' | 'rejected', notes }
 */
router.patch('/:id/decision', authenticateToken, requireRole('police_admin'), (req, res) => {
  const { decision, notes } = req.body;

  const missing = requireFields(req.body, ['decision']);
  if (missing.length) return missingFieldsResponse(res, missing);

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_DECISION', message: "decision must be 'approved' or 'rejected'" }
    });
  }

  const newStatus = decision === 'approved' ? 'verified' : 'rejected';

  db.run(`UPDATE volunteers SET status = ? WHERE id = ?`, [newStatus, req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (this.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Volunteer not found' } });

    db.run(
      `UPDATE verification_records SET reviewed_by = ?, notes = ?, decision = ?, decided_at = CURRENT_TIMESTAMP
       WHERE volunteer_id = ? AND decision = 'pending'`,
      [req.user.id, notes || null, decision, req.params.id],
      () => {
        res.json({ success: true, data: { volunteer_id: req.params.id, status: newStatus } });
      }
    );
  });
});

/**
 * PATCH /api/volunteers/:id/activate
 * police_admin only. Marks a verified volunteer as active (available for assignment).
 */
router.patch('/:id/activate', authenticateToken, requireRole('police_admin'), (req, res) => {
  db.get(`SELECT status FROM volunteers WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Volunteer not found' } });
    if (row.status !== 'verified') {
      return res.status(409).json({ success: false, error: { code: 'NOT_VERIFIED', message: 'Volunteer must be verified before activation' } });
    }

    db.run(`UPDATE volunteers SET status = 'active' WHERE id = ?`, [req.params.id], (uErr) => {
      if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: uErr.message } });
      res.json({ success: true, data: { volunteer_id: req.params.id, status: 'active' } });
    });
  });
});

module.exports = router;
