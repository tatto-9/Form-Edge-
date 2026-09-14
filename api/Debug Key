// TEMPORARY — delete this file once the key issue is fixed.
// Shows the length and first/last few characters of the stored key,
// so you can compare it against your real key without exposing the
// whole thing here in chat.

module.exports = function handler(req, res) {
  const key = process.env.PUNTINGFORM_API_KEY;

  if (!key) {
    return res.status(200).json({ found: false, message: 'PUNTINGFORM_API_KEY is not set at all' });
  }

  res.status(200).json({
    found: true,
    length: key.length,
    startsWith: key.slice(0, 4),
    endsWith: key.slice(-4),
    hasLeadingOrTrailingWhitespace: key !== key.trim(),
  });
};
