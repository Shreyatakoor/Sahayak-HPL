/**
 * Returns an array of missing field names from req.body.
 * Usage: const missing = requireFields(req.body, ['phone_number', 'password']);
 */
function requireFields(body, fields) {
  return fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
}

function missingFieldsResponse(res, missing) {
  return res.status(400).json({
    success: false,
    error: { code: 'MISSING_FIELDS', message: `Missing required field(s): ${missing.join(', ')}` }
  });
}

module.exports = { requireFields, missingFieldsResponse };
