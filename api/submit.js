import jwt from 'jsonwebtoken';

function verify(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('Unauthorized');
  return jwt.verify(token, process.env.JWT_SECRET);
}

export default async function handler(req, res) {
  try {
    verify(req);

    await fetch(process.env.GS_URL, {
      method: 'POST',
      body: JSON.stringify(req.body),
      headers: { 'Content-Type': 'text/plain' }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
