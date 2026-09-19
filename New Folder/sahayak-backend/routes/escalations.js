const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/escalations
 * police_admin only. Optional ?status=escalated filter.
 */
router.get('/', authenticateToken, requireRole('police_admin'), (req, res) => {
  const { status } = req.query;
  const sql = status
    ? `SELECT e.*, r.location, r.need, r.senior_citizen_id
       FROM emergency_escalations e JOIN assistance_requests r ON e.request_id = r.id
       WHERE e.status = ? ORDER BY e.created_at DESC`
    : `SELECT e.*, r.location, r.need, r.senior_citizen_id
       FROM emergency_escalations e JOIN assistance_requests r ON e.request_id = r.id
       ORDER BY e.created_at DESC`;
  const params = status ? [status] : [];

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    res.json({ success: true, data: rows });
  });
});

/**
 * GET /api/escalations/:id
 */
router.get('/:id', authenticateToken, requireRole('police_admin'), (req, res) => {
  db.get(`SELECT * FROM emergency_escalations WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Escalation not found' } });
    res.json({ success: true, data: row });
  });
});

/**
 * PATCH /api/escalations/:id/close
 * police_admin only. Closes an escalation once resolved on the ground,
 * and marks the underlying request completed.
 */
router.patch('/:id/close', authenticateToken, requireRole('police_admin'), (req, res) => {
  db.get(`SELECT * FROM emergency_escalations WHERE id = ?`, [req.params.id], (err, esc) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (!esc) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Escalation not found' } });
    if (esc.status === 'closed') {
      return res.status(409).json({ success: false, error: { code: 'ALREADY_CLOSED', message: 'Escalation already closed' } });
    }

    db.run(
      `UPDATE emergency_escalations SET status = 'closed', closed_by = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.user.id, req.params.id],
      (uErr) => {
        if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: uErr.message } });

        db.run(
          `UPDATE assistance_requests SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [esc.request_id],
          () => {
            res.json({ success: true, data: { id: req.params.id, status: 'closed', request_id: esc.request_id } });
          }
        );
      }
    );
  });
});

module.exports = router;
