-- CAT Prep Platform Database Schema
-- Run this file to initialize the database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'student', -- 'student' or 'admin'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Question papers / test templates
CREATE TABLE IF NOT EXISTS question_papers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 180,
  total_marks INTEGER NOT NULL DEFAULT 228,
  difficulty VARCHAR(50) DEFAULT 'medium', -- easy, medium, hard
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sections within a paper (VARC, DILR, QA)
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  paper_id UUID REFERENCES question_papers(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, -- 'VARC', 'DILR', 'QA'
  full_name VARCHAR(255) NOT NULL,
  question_count INTEGER NOT NULL,
  duration_minutes INTEGER,
  display_order INTEGER DEFAULT 0
);

-- Questions
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES question_papers(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  option_a TEXT,
  option_b TEXT,
  option_c TEXT,
  option_d TEXT,
  correct_option CHAR(1), -- 'A', 'B', 'C', 'D' or NULL for TITA
  question_type VARCHAR(50) DEFAULT 'MCQ', -- 'MCQ' or 'TITA' (Type In The Answer)
  correct_answer_tita TEXT, -- for TITA questions
  explanation TEXT,
  marks_correct INTEGER DEFAULT 3,
  marks_incorrect NUMERIC(3,1) DEFAULT -1,
  difficulty VARCHAR(50) DEFAULT 'medium',
  topic VARCHAR(255),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Test attempts
CREATE TABLE IF NOT EXISTS test_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  paper_id UUID REFERENCES question_papers(id),
  status VARCHAR(50) DEFAULT 'in_progress', -- 'in_progress', 'completed', 'abandoned'
  started_at TIMESTAMP DEFAULT NOW(),
  submitted_at TIMESTAMP,
  time_taken_seconds INTEGER,
  total_score NUMERIC(6,2),
  total_correct INTEGER DEFAULT 0,
  total_incorrect INTEGER DEFAULT 0,
  total_unattempted INTEGER DEFAULT 0,
  percentile NUMERIC(5,2),
  rank_among_attempts INTEGER
);

-- Individual answers per attempt
CREATE TABLE IF NOT EXISTS attempt_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id UUID REFERENCES questions(id),
  section_id UUID REFERENCES sections(id),
  selected_option CHAR(1), -- for MCQ
  tita_answer TEXT, -- for TITA
  is_marked_review BOOLEAN DEFAULT false,
  is_correct BOOLEAN,
  marks_obtained NUMERIC(3,1) DEFAULT 0,
  time_spent_seconds INTEGER DEFAULT 0,
  answered_at TIMESTAMP
);

-- Section-wise performance per attempt
CREATE TABLE IF NOT EXISTS section_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID REFERENCES test_attempts(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id),
  section_name VARCHAR(100),
  score NUMERIC(6,2) DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  incorrect_count INTEGER DEFAULT 0,
  unattempted_count INTEGER DEFAULT 0,
  accuracy NUMERIC(5,2) DEFAULT 0,
  time_spent_seconds INTEGER DEFAULT 0
);

-- Analytics: topic-wise performance across all attempts
CREATE TABLE IF NOT EXISTS topic_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  topic VARCHAR(255) NOT NULL,
  section_name VARCHAR(100),
  total_questions INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  incorrect_count INTEGER DEFAULT 0,
  accuracy NUMERIC(5,2) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Bookmarked questions
CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  question_id UUID REFERENCES questions(id),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, question_id)
);

-- Study goals & progress tracking
CREATE TABLE IF NOT EXISTS study_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  target_score NUMERIC(6,2),
  target_percentile NUMERIC(5,2),
  target_date DATE,
  tests_per_week INTEGER DEFAULT 2,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(section_id);
CREATE INDEX IF NOT EXISTS idx_questions_paper ON questions(paper_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON test_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_paper ON test_attempts(paper_id);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_topic_perf_user ON topic_performance(user_id);

-- Sample data: Insert a default admin user (password: admin123)
INSERT INTO users (name, email, password_hash, role) VALUES
('Admin', 'admin@catprep.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh.i', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Sample CAT 2024 Mock Paper
INSERT INTO question_papers (id, title, description, duration_minutes, total_marks, difficulty)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'CAT 2024 - Full Mock Test 1',
  'Complete CAT mock test with VARC, DILR and QA sections. 66 questions in 120 minutes.',
  120,
  198,
  'medium'
) ON CONFLICT (id) DO NOTHING;

-- Insert sections
INSERT INTO sections (id, paper_id, name, full_name, question_count, duration_minutes, display_order)
VALUES
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'VARC', 'Verbal Ability & Reading Comprehension', 24, 40, 1),
  ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'DILR', 'Data Interpretation & Logical Reasoning', 20, 40, 2),
  ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'QA', 'Quantitative Aptitude', 22, 40, 3)
ON CONFLICT (id) DO NOTHING;
