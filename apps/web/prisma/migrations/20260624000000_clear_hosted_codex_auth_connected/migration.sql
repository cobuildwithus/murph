UPDATE "hosted_codex_auth_connection"
SET
    "state" = 'connect_error',
    "verification_url" = NULL,
    "user_code" = NULL
WHERE "state" = 'connected';
