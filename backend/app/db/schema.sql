-- Interview Simulator — PostgreSQL Schema
-- Run once against a fresh database: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENUMS ────────────────────────────────────────────────────────────────────

CREATE TYPE interview_mode   AS ENUM ('DSA', 'SystemDesign', 'Behavioral');
CREATE TYPE target_role      AS ENUM ('SWE-L3', 'SWE-L4', 'SWE-L5', 'EM', 'PM');
CREATE TYPE target_company   AS ENUM ('Meta', 'Google', 'Amazon', 'Apple', 'Microsoft', 'Generic');
CREATE TYPE interview_phase  AS ENUM ('warmup', 'core', 'deep-dive', 'stress-test', 'closing');
CREATE TYPE question_type    AS ENUM ('opening', 'followup', 'probe', 'clarification', 'stress');
CREATE TYPE follow_up_type   AS ENUM (
    'optimization', 'edge_case', 'scale', 'tradeoff',
    'depth_probe', 'stress_test', 'clarification'
);
CREATE TYPE hiring_decision  AS ENUM ('Strong Hire', 'Hire', 'No Hire', 'Strong No Hire');

-- ─── SESSIONS ─────────────────────────────────────────────────────────────────

CREATE TABLE interview_sessions (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT         NOT NULL,
    mode             interview_mode NOT NULL,
    target_role      target_role  NOT NULL,
    target_company   target_company NOT NULL,

    -- Final snapshot of SessionState written at session end
    -- Authoritative copy lives in Redis (key: session:{id}:state) during active session
    final_state      JSONB,

    -- Populated by Recruiter Agent at session end
    final_report     JSONB,

    started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ,
    duration_seconds INTEGER,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id    ON interview_sessions (user_id);
CREATE INDEX idx_sessions_started_at ON interview_sessions (started_at DESC);
CREATE INDEX idx_sessions_mode       ON interview_sessions (mode);

-- ─── QUESTION RECORDS ─────────────────────────────────────────────────────────

CREATE TABLE question_records (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        UUID          NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
    question_text     TEXT          NOT NULL,
    question_type     question_type NOT NULL,
    follow_up_type    follow_up_type,
    parent_question_id UUID         REFERENCES question_records (id),
    difficulty_level  SMALLINT      NOT NULL CHECK (difficulty_level BETWEEN 1 AND 5),
    topic             TEXT          NOT NULL,
    asked_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- 1536-dim embedding for pgvector dedup (populated async after question is asked)
    embedding         vector(1536)
);

CREATE INDEX idx_qr_session_id ON question_records (session_id);
CREATE INDEX idx_qr_topic      ON question_records (topic);
-- HNSW index for sub-millisecond cosine similarity lookups
CREATE INDEX idx_qr_embedding  ON question_records USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ─── USER ANSWERS ─────────────────────────────────────────────────────────────

CREATE TABLE user_answers (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    question_record_id      UUID    NOT NULL UNIQUE REFERENCES question_records (id) ON DELETE CASCADE,
    transcript              TEXT    NOT NULL,
    audio_url               TEXT,
    duration_seconds        FLOAT   NOT NULL,

    -- SpeechMetrics flattened for analytics queries
    wpm                     FLOAT,
    filler_word_count       INTEGER,
    filler_word_list        TEXT[],
    pause_count             INTEGER,
    avg_pause_duration_ms   FLOAT,
    sentence_completion_rate FLOAT,
    hedge_word_count        INTEGER,
    technical_term_density  FLOAT,
    -- Stored 0–100; never sent raw to frontend — convert to behavioral label first
    confidence_score        FLOAT   CHECK (confidence_score BETWEEN 0 AND 100),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ua_question_record_id ON user_answers (question_record_id);

-- ─── ANSWER EVALUATIONS ───────────────────────────────────────────────────────

CREATE TABLE answer_evaluations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_record_id UUID NOT NULL UNIQUE REFERENCES question_records (id) ON DELETE CASCADE,

    -- Score dimensions flattened (value + rationale per dimension)
    -- value = -1 means "N/A for this interview mode"
    technical_correctness_value      SMALLINT CHECK (technical_correctness_value BETWEEN -1 AND 10),
    technical_correctness_rationale  TEXT,

    explanation_clarity_value        SMALLINT CHECK (explanation_clarity_value BETWEEN -1 AND 10),
    explanation_clarity_rationale    TEXT,

    structured_reasoning_value       SMALLINT CHECK (structured_reasoning_value BETWEEN -1 AND 10),
    structured_reasoning_rationale   TEXT,

    edge_case_handling_value         SMALLINT CHECK (edge_case_handling_value BETWEEN -1 AND 10),
    edge_case_handling_rationale     TEXT,

    -- DSA only
    time_complexity_awareness_value      SMALLINT CHECK (time_complexity_awareness_value BETWEEN -1 AND 10),
    time_complexity_awareness_rationale  TEXT,

    -- SystemDesign only
    tradeoff_discussion_value        SMALLINT CHECK (tradeoff_discussion_value BETWEEN -1 AND 10),
    tradeoff_discussion_rationale    TEXT,

    -- Behavioral only
    star_structure_value             SMALLINT CHECK (star_structure_value BETWEEN -1 AND 10),
    star_structure_rationale         TEXT,

    strengths                        TEXT[]  NOT NULL DEFAULT '{}',
    gaps                             TEXT[]  NOT NULL DEFAULT '{}',
    missed_concepts                  TEXT[]  NOT NULL DEFAULT '{}',

    -- Used by Interviewer Agent to decide next move; NEVER exposed to frontend
    interviewer_internal_note        TEXT    NOT NULL,

    created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ae_question_record_id ON answer_evaluations (question_record_id);

-- ─── ANALYTICS VIEW ───────────────────────────────────────────────────────────

CREATE VIEW session_question_analysis AS
SELECT
    s.id                              AS session_id,
    s.user_id,
    s.mode,
    s.target_role,
    s.target_company,
    q.id                              AS question_id,
    q.question_text,
    q.question_type,
    q.follow_up_type,
    q.difficulty_level,
    q.topic,
    q.asked_at,
    ua.transcript,
    ua.duration_seconds               AS answer_duration_seconds,
    ua.wpm,
    ua.confidence_score,
    ua.filler_word_count,
    ae.technical_correctness_value,
    ae.explanation_clarity_value,
    ae.structured_reasoning_value,
    ae.edge_case_handling_value,
    ae.time_complexity_awareness_value,
    ae.tradeoff_discussion_value,
    ae.star_structure_value,
    ae.strengths,
    ae.gaps,
    ae.missed_concepts
FROM interview_sessions s
JOIN  question_records   q  ON q.session_id        = s.id
LEFT JOIN user_answers   ua ON ua.question_record_id = q.id
LEFT JOIN answer_evaluations ae ON ae.question_record_id = q.id;

-- ─── QUESTION DEDUP HELPER ────────────────────────────────────────────────────
-- Usage: call with ($1 = new_embedding::vector, $2 = session_id)
-- Returns the most similar previously-asked question and its similarity score.
-- If similarity > 0.85, regenerate the question.
--
-- SELECT question_text, 1 - (embedding <=> $1) AS similarity
-- FROM question_records
-- WHERE session_id = $2 AND embedding IS NOT NULL
-- ORDER BY similarity DESC
-- LIMIT 1;
