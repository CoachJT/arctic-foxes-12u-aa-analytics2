-- 024: revoke default PUBLIC execute on the trigger functions added in 023.
--
-- These are `returns trigger` functions, so Postgres already refuses a direct
-- call with SQLSTATE 0A000 ("trigger functions can only be called as
-- triggers") -- the exposure was theoretical, not exploitable. Revoking anyway
-- so the two functions match the explicit grant model already used by
-- ensure_schedule_game_shell() and save_schedule_game(), and so the security
-- advisor stays clean rather than training us to ignore its warnings.
--
-- Triggers keep firing normally: trigger execution runs as the table owner and
-- does not consult EXECUTE grants on the trigger function. Verified in
-- production after applying: both the link and season triggers still reject
-- invalid writes.

revoke all on function public.validate_schedule_game_link() from public;
revoke all on function public.validate_schedule_game_link() from anon;

revoke all on function public.validate_team_schedule_game_season() from public;
revoke all on function public.validate_team_schedule_game_season() from anon;
