// /api/picks — save a pick (POST) or list all saved picks with running
// profit/loss (GET). Uses Vercel Postgres (added automatically to your
// project's env vars once you link a database in the Storage tab).

const { sql } = require('@vercel/postgres');

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS picks (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP DEFAULT now(),
      race_date DATE,
      track TEXT,
      race_number INT,
      race_name TEXT,
      meeting_id TEXT,
      horse TEXT,
      odds NUMERIC,
      stake NUMERIC DEFAULT 1,
      status TEXT DEFAULT 'pending'
    )
  `;
}

module.exports = async function handler(req, res) {
  try {
    await ensureTable();

    if (req.method === 'POST') {
      const { raceDate, track, raceNumber, raceName, meetingId, horse, odds } = req.body;
      if (!horse || !raceDate) {
        return res.status(400).json({ error: 'horse and raceDate are required' });
      }
      const result = await sql`
        INSERT INTO picks (race_date, track, race_number, race_name, meeting_id, horse, odds, stake, status)
        VALUES (${raceDate}, ${track || ''}, ${raceNumber || null}, ${raceName || ''}, ${meetingId || ''}, ${horse}, ${odds || null}, 1, 'pending')
        RETURNING id
      `;
      return res.status(200).json({ id: result.rows[0].id });
    }

    if (req.method === 'GET') {
      const result = await sql`SELECT * FROM picks ORDER BY race_date DESC, id DESC LIMIT 200`;
      const picks = result.rows;

      // Unit profit/loss: win pays (odds - 1) * stake, loss costs -stake,
      // pending picks aren't counted yet.
      let totalProfit = 0;
      let settledCount = 0;
      let wonCount = 0;
      picks.forEach(p => {
        if (p.status === 'won') {
          totalProfit += (Number(p.odds) - 1) * Number(p.stake);
          settledCount++; wonCount++;
        } else if (p.status === 'lost') {
          totalProfit -= Number(p.stake);
          settledCount++;
        }
      });

      return res.status(200).json({
        picks,
        summary: {
          totalProfit: Math.round(totalProfit * 100) / 100,
          settledCount,
          wonCount,
          pendingCount: picks.length - settledCount,
        },
      });
    }

    return res.status(405).json({ error: 'Use GET or POST' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
