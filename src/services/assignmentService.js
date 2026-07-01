const assignmentRepository = require('../repositories/assignmentRepository');

async function createAssignment({ title, description, dueDate, createdBy }) {
  if (!title) return { success: false, status: 400, message: 'Title is required' };
  await assignmentRepository.createAssignment({ title, description, dueDate, createdBy });
  return { success: true };
}

async function listAssignments(createdBy) {
  const rows = await assignmentRepository.listAssignments(createdBy);
  return { success: true, data: rows };
}

async function deleteAssignment(id) {
  await assignmentRepository.deleteAssignment(id);
  return { success: true };
}

module.exports = {
  createAssignment,
  listAssignments,
  deleteAssignment,
};
