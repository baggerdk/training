-- Trainer insight: a user's workout history newest first (GET /users/:id/sessions)
create index workout_sessions_history_idx on workout_sessions (user_id, started_at desc) where deleted_at is null;
