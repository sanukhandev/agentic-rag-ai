CREATE TABLE IF NOT EXISTS session_tokens (
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  token text NOT NULL,
  ciphertext text NOT NULL,
  PRIMARY KEY (session_id, token)
);
