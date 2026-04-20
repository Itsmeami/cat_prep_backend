const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Auth
const { register, login, getMe } = require('../controllers/authController');
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/me', authenticateToken, getMe);

// Papers
const { getAllPapers, getPaperById, createPaper, updatePaper, addQuestion, updateQuestion, deleteQuestion } = require('../controllers/papersController');
router.get('/papers', authenticateToken, getAllPapers);
router.get('/papers/:id', authenticateToken, getPaperById);
router.post('/papers', authenticateToken, requireAdmin, createPaper);
router.put('/papers/:id', authenticateToken, requireAdmin, updatePaper);
router.post('/questions', authenticateToken, requireAdmin, addQuestion);
router.put('/questions/:id', authenticateToken, requireAdmin, updateQuestion);
router.delete('/questions/:id', authenticateToken, requireAdmin, deleteQuestion);

// Attempts
const { startAttempt, saveAnswer, submitAttempt, getAttemptResult, getUserAttempts } = require('../controllers/attemptsController');
router.post('/attempts/start', authenticateToken, startAttempt);
router.post('/attempts/answer', authenticateToken, saveAnswer);
router.post('/attempts/submit', authenticateToken, submitAttempt);
router.get('/attempts', authenticateToken, getUserAttempts);
router.get('/attempts/:id/result', authenticateToken, getAttemptResult);

// Analytics
const { getDashboard, compareAttempts, saveStudyGoal, toggleBookmark, getBookmarks } = require('../controllers/analyticsController');
router.get('/analytics/dashboard', authenticateToken, getDashboard);
router.get('/analytics/compare', authenticateToken, compareAttempts);
router.post('/analytics/goal', authenticateToken, saveStudyGoal);
router.post('/analytics/bookmark', authenticateToken, toggleBookmark);
router.get('/analytics/bookmarks', authenticateToken, getBookmarks);

module.exports = router;
