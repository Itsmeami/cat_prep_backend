const pool = require('../config/database');

// Get all active papers
const getAllPapers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT qp.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM questions q WHERE q.paper_id = qp.id) as total_questions,
        (SELECT COUNT(*) FROM test_attempts ta WHERE ta.paper_id = qp.id AND ta.user_id = $1) as attempts_count
      FROM question_papers qp
      LEFT JOIN users u ON qp.created_by = u.id
      WHERE qp.is_active = true
      ORDER BY qp.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch papers' });
  }
};

// Get paper with sections and questions
const getPaperById = async (req, res) => {
  try {
    const { id } = req.params;

    const paperResult = await pool.query('SELECT * FROM question_papers WHERE id = $1', [id]);
    if (paperResult.rows.length === 0) return res.status(404).json({ error: 'Paper not found' });

    const sectionsResult = await pool.query(
      'SELECT * FROM sections WHERE paper_id = $1 ORDER BY display_order',
      [id]
    );

    const questionsResult = await pool.query(
      'SELECT * FROM questions WHERE paper_id = $1 ORDER BY display_order',
      [id]
    );

    const paper = paperResult.rows[0];
    paper.sections = sectionsResult.rows.map(s => ({
      ...s,
      questions: questionsResult.rows.filter(q => q.section_id === s.id)
    }));

    res.json(paper);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch paper' });
  }
};

// Create new paper
const createPaper = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { title, description, duration_minutes, difficulty, sections } = req.body;

    const paperResult = await client.query(
      `INSERT INTO question_papers (title, description, duration_minutes, difficulty, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, description, duration_minutes, difficulty, req.user.id]
    );
    const paper = paperResult.rows[0];

    if (sections && sections.length > 0) {
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const secResult = await client.query(
          `INSERT INTO sections (paper_id, name, full_name, question_count, duration_minutes, display_order)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [paper.id, s.name, s.full_name, s.questions?.length || 0, s.duration_minutes, i]
        );
        const section = secResult.rows[0];

        if (s.questions && s.questions.length > 0) {
          for (let j = 0; j < s.questions.length; j++) {
            const q = s.questions[j];
            await client.query(
              `INSERT INTO questions (section_id, paper_id, question_text, option_a, option_b, option_c, option_d,
               correct_option, question_type, correct_answer_tita, explanation, marks_correct, marks_incorrect,
               difficulty, topic, display_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
              [section.id, paper.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
               q.correct_option, q.question_type || 'MCQ', q.correct_answer_tita, q.explanation,
               q.marks_correct || 3, q.marks_incorrect || -1, q.difficulty || 'medium', q.topic, j]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json(paper);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create paper' });
  } finally {
    client.release();
  }
};

// Update paper
const updatePaper = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, duration_minutes, difficulty, is_active } = req.body;

    const result = await pool.query(
      `UPDATE question_papers SET title=$1, description=$2, duration_minutes=$3, difficulty=$4, is_active=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [title, description, duration_minutes, difficulty, is_active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update paper' });
  }
};

// Add question to a section
const addQuestion = async (req, res) => {
  try {
    const { section_id, paper_id, question_text, option_a, option_b, option_c, option_d,
            correct_option, question_type, correct_answer_tita, explanation,
            marks_correct, marks_incorrect, difficulty, topic } = req.body;

    const result = await pool.query(
      `INSERT INTO questions (section_id, paper_id, question_text, option_a, option_b, option_c, option_d,
       correct_option, question_type, correct_answer_tita, explanation, marks_correct, marks_incorrect, difficulty, topic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [section_id, paper_id, question_text, option_a, option_b, option_c, option_d,
       correct_option, question_type || 'MCQ', correct_answer_tita, explanation,
       marks_correct || 3, marks_incorrect || -1, difficulty || 'medium', topic]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add question' });
  }
};

// Update question
const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { question_text, option_a, option_b, option_c, option_d, correct_option,
            explanation, difficulty, topic } = req.body;

    const result = await pool.query(
      `UPDATE questions SET question_text=$1, option_a=$2, option_b=$3, option_c=$4, option_d=$5,
       correct_option=$6, explanation=$7, difficulty=$8, topic=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, topic, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update question' });
  }
};

// Delete question
const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM questions WHERE id = $1', [id]);
    res.json({ message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete question' });
  }
};

module.exports = { getAllPapers, getPaperById, createPaper, updatePaper, addQuestion, updateQuestion, deleteQuestion };
