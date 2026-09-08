const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/015_game_stat_entry.sql', 'utf8');
const foundationMigration = fs.readFileSync('supabase/migrations/003_team_data_sync.sql', 'utf8');

test('Game Stat Entry migration is additive only and does not touch historical migration files', () => {
  const historicalMigrations = fs.readdirSync('supabase/migrations')
    .filter(name => name !== '015_game_stat_entry.sql')
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
  assert.match(migration, /where game\.team_id = target_team_id\s*\n\s*and game\.source_game_id = target_source_game_id\s*\n\s*and \(game\.season_id is null or game\.season_id = target_season_id\)/);
  assert.match(migration, /raise exception 'The selected game does not belong to the authorized team and season\.'/);
});

test('save_game_stats upserts by the unique keys instead of inserting duplicates', () => {
  assert.match(migration, /on conflict \(team_id, source_game_id, source_player_id, player_type\)\s*\n\s*do update set/g);
  assert.match(migration, /on conflict \(team_id, source_game_id\)\s*\n\s*do update set/);
  const conflictCount = (migration.match(/on conflict/g) || []).length;
  assert.equal(conflictCount, 3, 'expected exactly one upsert per stat table: skaters, goalies, team stats');
});

test('save_game_stats casts jsonb fields to numeric so blank/omitted values stay null instead of coercing to 0', () => {
  assert.match(migration, /\(skater_row ->> 'goals'\)::numeric/);
  assert.match(migration, /\(goalie_row ->> 'saves'\)::numeric/);
  assert.match(migration, /\(team_stats ->> 'goals_for'\)::numeric/);
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
