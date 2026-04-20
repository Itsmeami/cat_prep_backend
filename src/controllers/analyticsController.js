const pool = require('../config/database');

// Full analytics dashboard for a user
const getDashboard = async (req, res) => {
  try {
    const user_id = req.user.id;

    // Overall stats
    const overallStats = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE status='completed') as total_tests,

    ROUND(AVG(total_score) FILTER (WHERE status='completed')::numeric, 2) as avg_score,  -- 🔧 FIX

    MAX(total_score) as best_score,

    ROUND(
      AVG(CAST(total_correct AS FLOAT) / NULLIF((total_correct + total_incorrect), 0) * 100)::numeric,
      2
    ) as avg_accuracy,  -- 🔧 FIX

    SUM(time_taken_seconds) FILTER (WHERE status='completed') as total_time_spent
  FROM test_attempts WHERE user_id = $1
`, [user_id]);

    // Score trend (last 10 tests)
    const scoreTrend = await pool.query(`
      SELECT ta.total_score, ta.submitted_at, qp.title as paper_title,
             ta.total_correct, ta.total_incorrect, ta.total_unattempted
      FROM test_attempts ta
      JOIN question_papers qp ON ta.paper_id = qp.id
      WHERE ta.user_id=$1 AND ta.status='completed'
      ORDER BY ta.submitted_at DESC
      LIMIT 10
    `, [user_id]);

    // Section-wise average performance
    const sectionAvg = await pool.query(`
  SELECT sp.section_name,

    ROUND(AVG(sp.score)::numeric, 2) as avg_score,          -- 🔧 FIX
    ROUND(AVG(sp.accuracy)::numeric, 2) as avg_accuracy,    -- 🔧 FIX
    ROUND(AVG(sp.correct_count)::numeric, 1) as avg_correct,-- 🔧 FIX

    COUNT(*) as attempts
  FROM section_performance sp
  JOIN test_attempts ta ON sp.attempt_id = ta.id
  WHERE ta.user_id=$1 AND ta.status='completed'
  GROUP BY sp.section_name
`, [user_id]);

    // Topic-wise performance (weakest areas)
    const topicPerf = await pool.query(`
      SELECT topic, section_name, total_questions, correct_count, incorrect_count,
             ROUND(accuracy, 2) as accuracy
      FROM topic_performance
      WHERE user_id=$1
      ORDER BY accuracy ASC
    `, [user_id]);

    // Weak areas (accuracy < 50%)
    const weakAreas = topicPerf.rows.filter(t => t.accuracy < 50);
    const strongAreas = topicPerf.rows.filter(t => t.accuracy >= 70);

    // Improvement over time (first vs last 5 tests per section)
    const recentSections = await pool.query(`
  SELECT sp.section_name,

    ROUND(AVG(sp.accuracy)::numeric, 2) as recent_accuracy  -- 🔧 FIX

  FROM section_performance sp
  JOIN test_attempts ta ON sp.attempt_id = ta.id
  WHERE ta.user_id=$1 AND ta.status='completed'
    AND ta.submitted_at >= NOW() - INTERVAL '30 days'
  GROUP BY sp.section_name
`, [user_id]);

    // Bookmarks count
    const bookmarksCount = await pool.query(
      `SELECT COUNT(*) as count FROM bookmarks WHERE user_id=$1`, [user_id]
    );

    // Study goal
    const studyGoal = await pool.query(
      `SELECT * FROM study_goals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [user_id]
    );

    res.json({
      overall: overallStats.rows[0],
      score_trend: scoreTrend.rows.reverse(),
      section_performance: sectionAvg.rows,
      topic_performance: topicPerf.rows,
      weak_areas: weakAreas,
      strong_areas: strongAreas,
      recent_section_performance: recentSections.rows,
      bookmarks_count: parseInt(bookmarksCount.rows[0].count),
      study_goal: studyGoal.rows[0] || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

// Comparative analysis between two attempts
const compareAttempts = async (req, res) => {
  try {
    const { attempt1, attempt2 } = req.query;
    const user_id = req.user.id;

    const attempts = await pool.query(`
      SELECT ta.*, qp.title FROM test_attempts ta
      JOIN question_papers qp ON ta.paper_id = qp.id
      WHERE ta.id = ANY($1::uuid[]) AND ta.user_id = $2
    `, [[attempt1, attempt2], user_id]);

    const sections = await pool.query(`
      SELECT * FROM section_performance WHERE attempt_id = ANY($1::uuid[])
    `, [[attempt1, attempt2]]);

    res.json({
      attempts: attempts.rows,
      section_breakdown: sections.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compare attempts' });
  }
};

// Save/update study goal
const saveStudyGoal = async (req, res) => {
  try {
    const { target_score, target_percentile, target_date, tests_per_week } = req.body;
    const user_id = req.user.id;

    // Upsert
    const existing = await pool.query(`SELECT id FROM study_goals WHERE user_id=$1`, [user_id]);
    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE study_goals SET target_score=$1, target_percentile=$2, target_date=$3, tests_per_week=$4
         WHERE user_id=$5 RETURNING *`,
        [target_score, target_percentile, target_date, tests_per_week, user_id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO study_goals (user_id, target_score, target_percentile, target_date, tests_per_week)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [user_id, target_score, target_percentile, target_date, tests_per_week]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save goal' });
  }
};

// Toggle bookmark
const toggleBookmark = async (req, res) => {
  try {
    const { question_id, note } = req.body;
    const user_id = req.user.id;

    const existing = await pool.query(
      `SELECT id FROM bookmarks WHERE user_id=$1 AND question_id=$2`, [user_id, question_id]
    );

    if (existing.rows.length > 0) {
      await pool.query(`DELETE FROM bookmarks WHERE user_id=$1 AND question_id=$2`, [user_id, question_id]);
      res.json({ bookmarked: false });
    } else {
      await pool.query(`INSERT INTO bookmarks (user_id, question_id, note) VALUES ($1,$2,$3)`, [user_id, question_id, note]);
      res.json({ bookmarked: true });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle bookmark' });
  }
};

// Get bookmarks
const getBookmarks = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
             q.correct_option, q.explanation, q.topic, s.name as section_name
      FROM bookmarks b
      JOIN questions q ON b.question_id = q.id
      JOIN sections s ON q.section_id = s.id
      WHERE b.user_id=$1
      ORDER BY b.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
};

module.exports = { getDashboard, compareAttempts, saveStudyGoal, toggleBookmark, getBookmarks };
