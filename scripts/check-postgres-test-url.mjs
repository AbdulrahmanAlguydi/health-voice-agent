if (!process.env.TEST_POSTGRES_URL?.trim()) {
  console.error("TEST_POSTGRES_URL must point to a disposable PostgreSQL test database.");
  process.exit(1);
}
