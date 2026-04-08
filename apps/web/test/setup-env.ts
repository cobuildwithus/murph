const HOSTED_WEB_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:1/murph_test";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = HOSTED_WEB_TEST_DATABASE_URL;
}
