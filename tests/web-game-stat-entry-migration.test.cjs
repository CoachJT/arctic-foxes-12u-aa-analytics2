const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/016_game_stat_entry.sql', 'utf8');
const foundationMigration = fs.readFileSync('supabase/migrations/003_team_data_sync.sql', 'utf8');

test('Game Stat Entry migration is additive only and does not touch historical migration files', () => {
  const historicalMigrations = fs.readdirSync('supabase/migrations')
    .filter(name => name !== '016_game_stat_entry.sql')
    .sort();
  assert.ok(historicalMigrations.length >= 12, 'expected prior migrations to remain untouched');
  // 003 defines the canonical player-stats schema; assert it is unmodified by
  // re-reading it and checking the columns this feature must not duplicate.
  assert.match(foundationMigration, /create table public\.team_game_player_stats/);
  const playerStatsTable = foundationMigration.match(/create table public\.team_game_player_stats \([\s\S]*?\n\);/)[0];
  assert.doesNotMatch(playerStatsTable, /shots_against/);
});

test('migration adds season_id additively (nullable, no destructive alterations)', () => {
  assert.match(migration, /alter table public\.team_games\s+add column if not exists season_id uuid references public\.seasons\(id\) on delete set null;/);
  assert.match(migration, /alter table public\.team_game_player_stats\s+add column if not exists season_id/);
  assert.match(migration, /alter table public\.team_game_team_stats\s+add column if not exists season_id/);
  assert.doesNotMatch(migration, /drop table/i);
  assert.doesNotMatch(migration, /drop column/i);
});

test('migration does not add a shots_against column to the skater/player-stats table', () => {
  const playerStatsAlter = migration.match(/alter table public\.team_game_player_stats[\s\S]*?;/g) || [];
  playerStatsAlter.forEach(statement => assert.doesNotMatch(statement, /shots_against/));
});

test('save_game_stats is SECURITY DEFINER, re-validates authorization server-side, and is authenticated-only', () => {
  assert.match(migration, /create or replace function public\.save_game_stats\(/);
  assert.match(migration, /security definer/);
  assert.match(migration, /has_workspace_feature_access\(target_team_id, target_season_id, 'stats\.edit', 'stats'\)/);
  assert.match(migration, /raise exception 'The current workspace is not authorized to edit stats for this team and season\.'/);
  assert.match(migration, /revoke all on function public\.save_game_stats\(uuid, uuid, text, jsonb, jsonb, jsonb\) from public, anon;/);
  assert.match(migration, /grant execute on function public\.save_game_stats\(uuid, uuid, text, jsonb, jsonb, jsonb\) to authenticated;/);
});

test('save_game_stats re-validates the game belongs to the caller\'s team and season, not just client-supplied ids', () => {
  assert.match(migration, /where game\.team_id = target_team_id\s*\n\s*and game\.source_game_id = target_source_game_id\s*\n\s*and \(game\.season_id is null or game\.season_id = target_season_id\)\s*\n\s*and game\.date <= current_date/);
  assert.match(migration, /raise exception 'The selected game does not belong to the authorized team and season, or is not yet eligible for stat entry\.'/);
});

test('save_game_stats upserts by the unique keys instead of inserting duplicates', () => {
  assert.match(migration, /on conflict \(team_id, source_game_id, source_player_id, player_type\)\s*\n\s*do update set/g);
  assert.match(migration, /on conflict \(team_id, source_game_id\)\s*\n\s*do update set/);
  const conflictCount = (migration.match(/on conflict/g) || []).length;
  assert.equal(conflictCount, 3, 'expected exactly one upsert per stat table: skaters, goalies, team stats');
});

test('save_game_stats parses every numeric field through parse_finite_stat instead of casting client JSON directly to numeric', () => {
  assert.doesNotMatch(migration, /\(skater_row ->> '[a-z_]+'\)::numeric/);
  assert.doesNotMatch(migration, /\(goalie_row ->> '[a-z_]+'\)::numeric/);
  assert.doesNotMatch(migration, /\(team_stats ->> '[a-z_]+'\)::numeric/);
  assert.match(migration, /public\.parse_finite_stat\(skater_row ->> 'goals', 'goals'\)/);
  assert.match(migration, /public\.parse_finite_stat\(goalie_row ->> 'saves', 'saves'\)/);
  assert.match(migration, /public\.parse_finite_stat\(team_stats ->> 'goals_for', 'goals_for'\)/);
});

test('a single PL/pgSQL function body is one transaction: any raised exception rolls back every prior statement in the call', () => {
  // No explicit COMMIT/savepoint release inside the function -- Postgres
  // guarantees the whole function executes in the caller's transaction, so a
  // raise exception after partial inserts undoes them all (documented inline).
  const functionBody = migration.match(/create or replace function public\.save_game_stats[\s\S]*?\$\$;/)[0];
  assert.doesNotMatch(functionBody, /\bcommit\b/i);
  assert.doesNotMatch(functionBody, /release savepoint/i);
  assert.match(migration, /Any failure raises an exception, which\s*\n-- rolls back every insert\/update made earlier in this call/);
});

test('validate_team_game_season trigger enforces team/season integrity even on direct table writes (defense in depth)', () => {
  assert.match(migration, /create or replace function public\.validate_team_game_season\(\)/);
  assert.match(migration, /create trigger team_games_validate_season/);
  assert.match(migration, /create trigger team_game_player_stats_validate_season/);
  assert.match(migration, /create trigger team_game_team_stats_validate_season/);
  assert.match(migration, /raise exception 'The selected season does not belong to this team\.'/);
});

test('migration ends with runtime assertions proving anonymous execution stays revoked', () => {
  assert.match(migration, /has_function_privilege\('anon', 'public\.save_game_stats\(uuid,uuid,text,jsonb,jsonb,jsonb\)', 'execute'\)/);
  assert.match(migration, /raise exception 'Anonymous execution is granted for save_game_stats\.'/);
});

test('save_game_stats validates every skater/goalie row against this team\'s roster, blocking cross-team player IDs', () => {
  assert.match(migration, /select 1 from public\.team_roster_players roster\s*\n\s*where roster\.team_id = target_team_id\s*\n\s*and roster\.source_player_id = skater_row ->> 'source_player_id'\s*\n\s*and roster\.player_type = 'skater'/);
  assert.match(migration, /select 1 from public\.team_roster_players roster\s*\n\s*where roster\.team_id = target_team_id\s*\n\s*and roster\.source_player_id = goalie_row ->> 'source_player_id'\s*\n\s*and roster\.player_type = 'goalie'/);
  assert.match(migration, /raise exception 'Skater % is not on this team''s roster\.'/);
  assert.match(migration, /raise exception 'Goalie % is not on this team''s roster\.'/);
});

test('save_game_stats never trusts client-supplied derived stats: it only accepts and writes raw canonical columns', () => {
  assert.doesNotMatch(migration, /'points'|'pts'|'save_pct'|'sv_pct'|'gaa'|'faceoff_pct'/);
});

test('parse_finite_stat preserves null-vs-zero, rejects unparsable input, and rejects NaN/Infinity/-Infinity before any numeric column is written', () => {
  assert.match(migration, /create or replace function public\.parse_finite_stat\(raw_value text, field_label text\)/);
  assert.match(migration, /if raw_value is null or length\(trim\(raw_value\)\) = 0 then\s*\n\s*return null;/);
  assert.match(migration, /parsed := raw_value::numeric;/);
  assert.match(migration, /if parsed::text ~\* 'inf\|nan' then/);
  assert.match(migration, /raise exception 'The value for % must be a finite number\.', field_label;/);
  assert.match(migration, /revoke all on function public\.parse_finite_stat\(text, text\) from public, anon;/);
  assert.match(migration, /grant execute on function public\.parse_finite_stat\(text, text\) to authenticated;/);
});

test('save_game_stats rejects future/ineligible games server-side using the canonical game date, independent of client UI claims', () => {
  assert.match(migration, /and game\.date <= current_date/);
  assert.match(migration, /is not yet eligible for stat entry/);
});

test('migration self-tests parse_finite_stat against NaN as part of its own runtime assertions', () => {
  assert.match(migration, /public\.parse_finite_stat\('NaN', 'test'\)/);
  assert.match(migration, /parse_finite_stat failed to reject NaN/);
});

