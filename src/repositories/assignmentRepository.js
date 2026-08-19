const { db } = require('../models/database');

async function createAssignment({ title, description, dueDate, createdBy }) {
  await db.execute({
    sql: `INSERT INTO assignments (title, description, due_date, created_by) VALUES (?, ?, ?, ?)`,
    args: [title, description || '', dueDate || null, createdBy],
  });
}

async function listAssignments(createdBy) {
  const result = await db.execute({
    sql: `
      SELECT id, title, description, due_date, created_by, created_at
      FROM assignments
      WHERE created_by = ?
      ORDER BY due_date ASC, created_at DESC
    `,
    args: [createdBy],
  });
  return result.rows;
}

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
