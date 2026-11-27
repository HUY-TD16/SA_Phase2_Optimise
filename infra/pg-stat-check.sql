CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 10 slow queries by total execution time
SELECT calls, round(total_exec_time::numeric, 2) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms, left(query, 120) AS sql
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- Active lock waits
SELECT pid, state, wait_event_type, wait_event, left(query, 100) AS sql
FROM pg_stat_activity
WHERE datname = current_database() AND wait_event_type = 'Lock';
