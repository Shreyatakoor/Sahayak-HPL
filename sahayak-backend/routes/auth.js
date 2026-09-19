const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { requireFields, missingFieldsResponse } = require('../utils/validators');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'sahayak_jwt_secret_key_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';

/**
 * POST /api/auth/register
 * Registers a senior_citizen or a volunteer.
 * Volunteers additionally get a row in `volunteers` with status 'registered'.
 */
router.post('/register', (req, res) => {
  const { role, name, phone_number, password, organisation_id } = req.body;

  const missing = requireFields(req.body, ['role', 'name', 'phone_number', 'password']);
  if (missing.length) return missingFieldsResponse(res, missing);

  if (!['senior_citizen', 'volunteer'].includes(role)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_ROLE', message: "role must be 'senior_citizen' or 'volunteer'" }
    });
  }

  const userId = 'usr-' + Date.now();
  const passwordHash = bcrypt.hashSync(password, 12);

  db.run(
    `INSERT INTO users (id, role, name, phone_number, password_hash) VALUES (?, ?, ?, ?, ?)`,
    [userId, role, name, phone_number, passwordHash],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(409).json({
            success: false,
            error: { code: 'PHONE_EXISTS', message: 'A user with this phone number already exists' }
          });
        }
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
      }

      if (role === 'volunteer') {
        const volunteerId = 'vol-' + Date.now();
        db.run(
          `INSERT INTO volunteers (id, user_id, name, organisation_id, status) VALUES (?, ?, ?, ?, 'registered')`,
          [volunteerId, userId, name, organisation_id || null],
          (vErr) => {
            if (vErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: vErr.message } });
            return res.status(201).json({
              success: true,
              data: { user_id: userId, volunteer_id: volunteerId, role, status: 'registered' }
            });
          }
        );
      } else {
        return res.status(201).json({ success: true, data: { user_id: userId, role } });
      }
    }
  );
});

/**
 * POST /api/auth/login
 * Returns a JWT valid for JWT_EXPIRES_IN.
 */
router.post('/login', (req, res) => {
  const { phone_number, password } = req.body;

  const missing = requireFields(req.body, ['phone_number', 'password']);
  if (missing.length) return missingFieldsResponse(res, missing);

  db.get(`SELECT * FROM users WHERE phone_number = ?`, [phone_number], (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
    }
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid phone number or password' }
      });
    }

    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
    });

    res.json({
      success: true,
      token,
      data: { id: user.id, role: user.role, name: user.name }
    });
  });
});

module.exports = router;
