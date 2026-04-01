-- Minimize previously stored hosted user metadata now that the application only writes privacy-reduced fields.

UPDATE hosted_member
SET phone_number = CASE
  WHEN normalized_phone_number IS NULL OR normalized_phone_number = '' THEN 'your number'
  ELSE '*** ' || RIGHT(normalized_phone_number, 4)
END
WHERE phone_number IS DISTINCT FROM CASE
  WHEN normalized_phone_number IS NULL OR normalized_phone_number = '' THEN 'your number'
  ELSE '*** ' || RIGHT(normalized_phone_number, 4)
END;

UPDATE hosted_session
SET user_agent = NULL
WHERE user_agent IS NOT NULL;

UPDATE hosted_ai_usage
SET provider_session_id = NULL,
    provider_request_id = NULL,
    provider_metadata_json = NULL,
    raw_usage_json = NULL
WHERE provider_session_id IS NOT NULL
   OR provider_request_id IS NOT NULL
   OR provider_metadata_json IS NOT NULL
   OR raw_usage_json IS NOT NULL;

UPDATE hosted_share_link
SET preview_title = 'Shared Murph pack',
    preview_json = NULL
WHERE preview_title IS DISTINCT FROM 'Shared Murph pack'
   OR preview_json IS NOT NULL;
