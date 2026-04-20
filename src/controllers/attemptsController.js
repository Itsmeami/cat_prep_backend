const pool = require('../config/database');

// Start a new test attempt
const startAttempt = async (req, res) => {
  try {
    const { paper_id } = req.body;
    const user_id = req.user.id;

    // Check if there's an in-progress attempt
    const existing = await pool.query(
      `SELECT id FROM test_attempts WHERE user_id=$1 AND paper_id=$2 AND status='in_progress'`,
      [user_id, paper_id]
    );

    if (existing.rows.length > 0) {
      return res.json({ attempt_id: existing.rows[0].id, resumed: true });
    }

    const result = await pool.query(
      `INSERT INTO test_attempts (user_id, paper_id, status) VALUES ($1, $2, 'in_progress') RETURNING *`,
      [user_id, paper_id]
    );

    res.status(201).json({ attempt_id: result.rows[0].id, resumed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start test' });
  }
};

// Save answer during test
const saveAnswer = async (req, res) => {
  try {
    const { attempt_id, question_id, section_id, selected_option, tita_answer, is_marked_review, time_spent_seconds } = req.body;

    // Check if answer already exists
    const existing = await pool.query(
      `SELECT id FROM attempt_answers WHERE attempt_id=$1 AND question_id=$2`,
      [attempt_id, question_id]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE attempt_answers SET selected_option=$1, tita_answer=$2, is_marked_review=$3,
         time_spent_seconds=time_spent_seconds+$4, answered_at=NOW() WHERE attempt_id=$5 AND question_id=$6`,
        [selected_option, tita_answer, is_marked_review, time_spent_seconds || 0, attempt_id, question_id]
      );
    } else {
      await pool.query(
        `INSERT INTO attempt_answers (attempt_id, question_id, section_id, selected_option, tita_answer, is_marked_review, time_spent_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [attempt_id, question_id, section_id, selected_option, tita_answer, is_marked_review || false, time_spent_seconds || 0]
      );
    }

    res.json({ saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save answer' });
  }
};

// Submit test and calculate scores
const submitAttempt = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { attempt_id, time_taken_seconds } = req.body;
    const user_id = req.user.id;

    // Get all answers with correct answers
    const answersResult = await client.query(`
      SELECT aa.*, q.correct_option, q.correct_answer_tita, q.question_type,
             q.marks_correct, q.marks_incorrect, q.topic, s.name as section_name
      FROM attempt_answers aa
      JOIN questions q ON aa.question_id = q.id
      JOIN sections s ON aa.section_id = s.id
      WHERE aa.attempt_id = $1
    `, [attempt_id]);

    const answers = answersResult.rows;

    // Get total questions to find unattempted
    const attemptInfo = await client.query(
      `SELECT ta.paper_id FROM test_attempts ta WHERE ta.id = $1`,
      [attempt_id]
    );
    const paper_id = attemptInfo.rows[0].paper_id;

    const totalQuestionsResult = await client.query(
      `SELECT COUNT(*) as count FROM questions WHERE paper_id = $1`, [paper_id]
    );
    const totalQuestions = parseInt(totalQuestionsResult.rows[0].count);

    // Score calculation
    let totalScore = 0;
    let totalCorrect = 0;
    let totalIncorrect = 0;
    const sectionMap = {};
    const topicMap = {};

    for (const ans of answers) {
      let isCorrect = false;
      let marksObtained = 0;

      const hasAnswer = ans.selected_option || ans.tita_answer;

      if (hasAnswer) {
        if (ans.question_type === 'TITA') {
          isCorrect = ans.tita_answer?.trim().toLowerCase() === ans.correct_answer_tita?.trim().toLowerCase();
        } else {
          isCorrect = ans.selected_option === ans.correct_option;
        }

        if (isCorrect) {
          marksObtained = ans.marks_correct;
          totalCorrect++;
        } else {
          marksObtained = ans.question_type === 'TITA' ? 0 : ans.marks_incorrect;
          if (!isCorrect && hasAnswer) totalIncorrect++;
        }

        totalScore += parseFloat(marksObtained);
      }

      // Update answer record
      await client.query(
        `UPDATE attempt_answers SET is_correct=$1, marks_obtained=$2 WHERE id=$3`,
        [isCorrect, marksObtained, ans.id]
      );

      // Aggregate by section
      if (!sectionMap[ans.section_id]) {
        sectionMap[ans.section_id] = {
          section_name: ans.section_name,
          score: 0, correct: 0, incorrect: 0, time_spent: 0, total: 0
        };
      }
      sectionMap[ans.section_id].score += parseFloat(marksObtained);
      if (isCorrect) sectionMap[ans.section_id].correct++;
      else if (hasAnswer) sectionMap[ans.section_id].incorrect++;
      sectionMap[ans.section_id].time_spent += ans.time_spent_seconds || 0;
      sectionMap[ans.section_id].total++;

      // Aggregate by topic
      if (ans.topic) {
        const topicKey = `${ans.topic}__${ans.section_name}`;
        if (!topicMap[topicKey]) {
          topicMap[topicKey] = { topic: ans.topic, section_name: ans.section_name, total: 0, correct: 0, incorrect: 0 };
        }
        topicMap[topicKey].total++;
        if (isCorrect) topicMap[topicKey].correct++;
        else if (hasAnswer) topicMap[topicKey].incorrect++;
      }
    }

    const totalUnattempted = totalQuestions - answers.filter(a => a.selected_option || a.tita_answer).length;

    // Update attempt
    await client.query(`
      UPDATE test_attempts SET status='completed', submitted_at=NOW(), time_taken_seconds=$1,
      total_score=$2, total_correct=$3, total_incorrect=$4, total_unattempted=$5
      WHERE id=$6
    `, [time_taken_seconds, totalScore, totalCorrect, totalIncorrect, totalUnattempted, attempt_id]);

    // Insert section performance
    for (const [section_id, data] of Object.entries(sectionMap)) {
      const accuracy = data.total > 0 ? (data.correct / data.total) * 100 : 0;
      await client.query(`
        INSERT INTO section_performance (attempt_id, section_id, section_name, score, correct_count,
        incorrect_count, unattempted_count, accuracy, time_spent_seconds)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
      `, [attempt_id, section_id, data.section_name, data.score, data.correct, data.incorrect, 0, accuracy, data.time_spent]);
    }

    // Update topic performance
    for (const data of Object.values(topicMap)) {
      const accuracy = data.total > 0 ? (data.correct / data.total) * 100 : 0;
      await client.query(`
        INSERT INTO topic_performance (user_id, topic, section_name, total_questions, correct_count, incorrect_count, accuracy)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING
      `, [user_id, data.topic, data.section_name, data.total, data.correct, data.incorrect, accuracy]);
    }

    await client.query('COMMIT');

    // Return full result
    const finalAttempt = await pool.query(
      `SELECT * FROM test_attempts WHERE id = $1`, [attempt_id]
    );

    res.json({
      message: 'Test submitted successfully',
      attempt: finalAttempt.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to submit test' });
  } finally {
    client.release();
  }
};

// Get attempt result with full analysis
const getAttemptResult = async (req, res) => {
  try {
    const { id } = req.params;

    const attempt = await pool.query(`
      SELECT ta.*, qp.title as paper_title, qp.total_marks
      FROM test_attempts ta
      JOIN question_papers qp ON ta.paper_id = qp.id
      WHERE ta.id = $1 AND ta.user_id = $2
    `, [id, req.user.id]);

    if (attempt.rows.length === 0) return res.status(404).json({ error: 'Attempt not found' });

    const sectionPerf = await pool.query(
      `SELECT * FROM section_performance WHERE attempt_id = $1`, [id]
    );

    const answers = await pool.query(`
      SELECT aa.*, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
             q.correct_option, q.explanation, q.topic, q.difficulty, s.name as section_name
      FROM attempt_answers aa
      JOIN questions q ON aa.question_id = q.id
      JOIN sections s ON aa.section_id = s.id
      WHERE aa.attempt_id = $1
      ORDER BY s.display_order, q.display_order
    `, [id]);

    res.json({
      attempt: attempt.rows[0],
      section_performance: sectionPerf.rows,
      answers: answers.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch result' });
  }
};

// Get all attempts for a user
const getUserAttempts = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ta.*, qp.title as paper_title, qp.total_marks, qp.difficulty
      FROM test_attempts ta
      JOIN question_papers qp ON ta.paper_id = qp.id
      WHERE ta.user_id = $1
      ORDER BY ta.started_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attempts' });
  }
};

module.exports = { startAttempt, saveAnswer, submitAttempt, getAttemptResult, getUserAttempts };
