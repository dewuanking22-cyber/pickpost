// Injectable clock so tests can move time (locking / grading) without waiting.
module.exports = { now: () => new Date() };
