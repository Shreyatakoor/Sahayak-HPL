const express = require('express');
const db = require('../config/database');
const { authenticateToken, authenticateApiKey, requireRole } = require('../middleware/auth');
const { requireFields, missingFieldsResponse } = require('../utils/validators');

const router = express.Router();

/**
 * POST /api/requests
 * Creates an assistance request. Authenticated via x-api-key (e.g. the voice/IVR
 * platform submitting on behalf of a senior citizen caller). If is_emergency is
 * true, the request is auto-escalated to the 112 emergency workflow.
 * body: { senior_citizen_id, location, need, priority?, is_emergency? }
 */
router.post('/', authenticateApiKey, (req, res) => {
  const { senior_citizen_id, location, need, priority = 'routine', is_emergency = false } = req.body;

  const missing = requireFields(req.body, ['senior_citizen_id', 'location', 'need']);
  if (missing.length) return missingFieldsResponse(res, missing);

  if (!['routine', 'urgent'].includes(priority)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_PRIORITY', message: "priority must be 'routine' or 'urgent'" }
    });
  }

  const reqId = 'req-' + Date.now();
  const reqStatus = is_emergency ? 'escalated' : 'open';

  db.run(
    `INSERT INTO assistance_requests (id, senior_citizen_id, location, need, priority, is_emergency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reqId, senior_citizen_id, location, need, priority, is_emergency ? 1 : 0, reqStatus],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });

      if (is_emergency) {
        const escId = 'esc-' + Date.now();
        db.run(
          `INSERT INTO emergency_escalations (id, request_id, notified_112, status) VALUES (?, ?, 1, 'escalated')`,
          [escId, reqId],
          (eErr) => {
            if (eErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: eErr.message } });
            res.status(201).json({
              success: true,
              data: { id: reqId, status: 'escalated', emergency_escalation_id: escId }
            });
          }
        );
      } else {
        res.status(201).json({ success: true, data: { id: reqId, status: 'open' } });
      }
    }
  );
});

/**
 * GET /api/requests
 * JWT auth. police_admin sees everything, volunteer sees open + their own
 * assignments, senior_citizen sees their own requests.
 * Optional ?status=open filter.
 */
router.get('/', authenticateToken, (req, res) => {
  const { status } = req.query;
  const params = [];
  let sql = `SELECT * FROM assistance_requests`;
  const clauses = [];

  if (req.user.role === 'volunteer') {
    clauses.push(`(status = 'open' OR assigned_volunteer_id = ?)`);
    params.push(req.user.id);
  } else if (req.user.role === 'senior_citizen') {
    clauses.push(`senior_citizen_id = ?`);
    params.push(req.user.id);
  }
  // police_admin: no restriction

  if (status) {
    clauses.push(`status = ?`);
    params.push(status);
  }

  if (clauses.length) sql += ` WHERE ` + clauses.join(' AND ');
  sql += ` ORDER BY created_at DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    res.json({ success: true, data: rows });
  });
});

/**
 * GET /api/requests/:id
 */
router.get('/:id', authenticateToken, (req, res) => {
  db.get(`SELECT * FROM assistance_requests WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Request not found' } });

    if (
      req.user.role === 'senior_citizen' && row.senior_citizen_id !== req.user.id ||
      req.user.role === 'volunteer' && row.assigned_volunteer_id && row.assigned_volunteer_id !== req.user.id
    ) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to view this request' } });
    }
    res.json({ success: true, data: row });
  });
});

/**
 * PATCH /api/requests/:id/assign
 * police_admin only. Assigns an active volunteer to an open request.
 * body: { volunteer_id }
 */
router.patch('/:id/assign', authenticateToken, requireRole('police_admin'), (req, res) => {
  const { volunteer_id } = req.body;
  const missing = requireFields(req.body, ['volunteer_id']);
  if (missing.length) return missingFieldsResponse(res, missing);

  db.get(`SELECT status FROM volunteers WHERE id = ?`, [volunteer_id], (vErr, vol) => {
    if (vErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: vErr.message } });
    if (!vol) return res.status(404).json({ success: false, error: { code: 'VOLUNTEER_NOT_FOUND', message: 'Volunteer not found' } });
    if (vol.status !== 'active') {
      return res.status(409).json({ success: false, error: { code: 'VOLUNTEER_NOT_ACTIVE', message: 'Volunteer is not active' } });
    }

    db.run(
      `UPDATE assistance_requests SET assigned_volunteer_id = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'open'`,
      [volunteer_id, req.params.id],
      function (uErr) {
        if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: uErr.message } });
        if (this.changes === 0) {
          return res.status(409).json({ success: false, error: { code: 'NOT_ASSIGNABLE', message: 'Request not found or not open' } });
        }
        res.json({ success: true, data: { id: req.params.id, status: 'assigned', assigned_volunteer_id: volunteer_id } });
      }
    );
  });
});

/**
 * PATCH /api/requests/:id/status
 * police_admin or the assigned volunteer. Advances request status.
 * body: { status: 'in_progress' | 'completed' | 'cancelled' }
 */
router.patch('/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  const missing = requireFields(req.body, ['status']);
  if (missing.length) return missingFieldsResponse(res, missing);

  const allowed = ['in_progress', 'completed', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: `status must be one of: ${allowed.join(', ')}` } });
  }

  db.get(`SELECT * FROM assistance_requests WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Request not found' } });

    if (req.user.role === 'volunteer' && row.assigned_volunteer_id !== req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not assigned to this request' } });
    }
    if (req.user.role === 'senior_citizen') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to update status' } });
    }

    db.run(
      `UPDATE assistance_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, req.params.id],
      (uErr) => {
        if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: uErr.message } });
        res.json({ success: true, data: { id: req.params.id, status } });
      }
    );
  });
});

module.exports = router;
