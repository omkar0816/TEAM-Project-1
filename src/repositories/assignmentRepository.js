const { db } = require('../models/database');

async function createAssignment({ title, description, dueDate, createdBy }) {
  await db.execute({
    sql: `INSERT INTO assignments (title, description, due_date, created_by) VALUES (?, ?, ?, ?)`,
    args: [title, description || '', dueDate || null, createdBy],
  });
}

const result = req.session.role === 'teacher'
  ? await assignmentService.listAssignments(req.session.userId)
  : await assignmentService.listAllAssignments();

async function deleteAssignment(id) {
  await db.execute({
    sql: `DELETE FROM assignments WHERE id = ?`,
    args: [id],
  });
}

module.exports = {
  createAssignment,
  listAssignments,
  deleteAssignment,
};
