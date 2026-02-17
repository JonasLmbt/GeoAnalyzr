# Records backlog (grouped ideas)

Goal: a comprehensive “Personal Records” set across multiple grains. Each record should:
- Be clickable (drilldown) so the value can stay compact (no long date strings in the stat row).
- Have data-quality guardrails (skip groups with missing/obviously broken fields).
- Prefer “rate” metrics when sample size is reasonable, otherwise show count + n.

Notation:
- Grain: `round` / `game` / `session`
- Grouping: dimension like `time_day`, `game_id`, `session_start`, `true_country`, etc.
- Extreme: `max` / `min`

## Day records (groupBy `time_day`, grain `round`)

**Score**
- Day with highest avg score (avg_score, max)
- Day with lowest avg score (avg_score, min)
- Day with highest median score (score_median, max)
- Day with highest near-perfect rate (near_perfect_rate, max)
- Day with most 5ks (5k_count, max)
- Day with highest 5k rate (5k_rate, max)
- Day with most hits (hit_count, max)
- Day with highest hit rate (hit_rate, max)
- Day with most throws (<50) (throw_count, max)
- Day with highest throw rate (throw_rate, max)

**Speed / time**
- Day with lowest avg guess duration (avg_guess_duration, min)
- Day with highest avg guess duration (avg_guess_duration, max)
- Day with lowest median guess duration (guess_duration_median, min)
- Day with most fast rounds (<10s / <20s) (fast_rounds_count, max)

**Distance**
- Day with lowest avg distance (avg_distance_km, min)
- Day with highest avg distance (avg_distance_km, max)

**Consistency**
- Day with lowest score stddev (score_stddev, min)
- Day with highest score spread (score_spread, max)

## Game records (groupBy `game_id`, grain `round`)

**Score**
- Game with highest avg score (avg_score, max)
- Game with lowest avg score (avg_score, min)
- Game with highest total score (score_sum, max)
- Game with most 5ks (5k_count, max)
- Game with highest 5k rate (5k_rate, max)
- Game with most hits (hit_count, max)
- Game with highest hit rate (hit_rate, max)
- Game with most throws (<50) (throw_count, max)

**Speed / time**
- Game with lowest avg guess duration (avg_guess_duration, min)
- Game with highest avg guess duration (avg_guess_duration, max)

**Distance**
- Game with lowest avg distance (avg_distance_km, min)
- Game with highest avg distance (avg_distance_km, max)

**Special**
- Biggest score spread in a game (score_spread, max)

## Round records (grain `round`, no grouping)

**Score / accuracy**
- Highest score round (best_score, max)
- Lowest score round (worst_score, min)
- Fastest 5k (durationSeconds, min with filter score==5000)
- Fastest hit (durationSeconds, min with filter is_hit==true)
- Closest guess (distanceKm, min)
- Farthest guess (distanceKm, max)

**Speed**
- Fastest round (durationSeconds, min)
- Slowest round (durationSeconds, max)

## Session records (grain `session`, groupBy `session_start` or `session_index`)

**Performance**
- Session with highest avg score (session_avg_score, max)
- Session with lowest avg score (session_avg_score, min)
- Session with highest hit rate (session_hit_rate, max)
- Session with highest 5k rate (session_fivek_rate, max)
- Session with most 5ks (session_5k_count, max)
- Session with most hits (session_hit_count, max)
- Session with most throws (session_throw_count, max)

**Speed**
- Session with lowest avg guess duration (session_avg_guess_duration, min)
- Session with highest avg guess duration (session_avg_guess_duration, max)
- Longest session (session_duration_minutes, max)

**Rating**
- Biggest session rating gain (session_delta_rating, max)
- Biggest session rating loss (session_delta_rating, min)

## Rating records (grain `game`, no grouping or groupBy `time_day`)

**Summary**
- Trend in period (rating_trend)
- Avg rating delta (rating_delta_avg)
- Highest rating delta (rating_delta_highest, max) + drilldown to the game
- Lowest rating delta (rating_delta_lowest, min) + drilldown to the game

**Peaks**
- Best rating ever (best_end_rating, max) + drilldown to the game

## Streaks (grain `round` or `game`)

**Round streaks**
- Best 5k streak (filter score==5000)
- Best hit streak (filter is_hit==true)
- Worst throw streak (filter is_throw==true)

**Game streaks**
- Longest win streak (longest_win_streak)
- Longest loss streak (longest_loss_streak)

## Data-quality guardrails (implementation notes)

- For any avg over `game_id`: require near-complete coverage (e.g. all rounds have score for avg_score).
- For duration-based records: ignore 0; if timestamps exist (startTime/endTime), prefer derived duration and reject mismatches.
- For small-n rate records (hit_rate/5k_rate): require minimum rounds (e.g. n>=20) to avoid noise, or display both rate + n prominently.
