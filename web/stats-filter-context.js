/* Temporary boundary for Session B's shared Stats 2.0 selector/calculation module. */
(function (root) {
  'use strict';

  if (root.FoxesStatsFilter) return;

  const number = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const recorded = value => value !== null && value !== undefined && value !== '';
  const values = (rows, field) => rows.map(row => number(row?.[field])).filter(value => value !== null);

  root.FoxesStatsFilter = Object.freeze({
    temporaryStub: true,
    createContext({ games = [], teamStats = [], playerStats = [] } = {}) {
      const selectedGames = [...games].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
      const selectedGameIds = selectedGames.map(game => game.source_game_id).filter(Boolean);
      return Object.freeze({
        mode: 'all-season',
        params: {},
        selectedGameIds,
        selectedGames,
        availableCount: selectedGames.length,
        actualCount: selectedGames.length,
        teamStats,
        playerStats,
        isRecorded: recorded,
        value: number,
        average: (rows, field) => this.average(rows, field),
        sum: (rows, field) => this.sum(rows, field),
        recordedCount: (rows, field) => this.recordedCount(rows, field),
        ratio: (rows, numerator, denominator) => {
          const paired = rows.filter(row => number(row?.[numerator]) !== null && number(row?.[denominator]) !== null);
          const numeratorTotal = this.sum(paired, numerator);
          const denominatorTotal = this.sum(paired, denominator);
          return denominatorTotal === null || denominatorTotal === 0 ? (paired.length ? 0 : null) : numeratorTotal / denominatorTotal;
        }
      });
    },
    average(rows, field) {
      const valuesForField = values(rows, field);
      return valuesForField.length ? valuesForField.reduce((sum, value) => sum + value, 0) / valuesForField.length : null;
    },
    sum(rows, field) {
      const valuesForField = values(rows, field);
      return valuesForField.length ? valuesForField.reduce((sum, value) => sum + value, 0) : null;
    },
    recordedCount(rows, field) {
      return values(rows, field).length;
    },
    ratio(rows, numerator, denominator) {
      const paired = rows.filter(row => number(row?.[numerator]) !== null && number(row?.[denominator]) !== null);
      const numeratorTotal = this.sum(paired, numerator);
      const denominatorTotal = this.sum(paired, denominator);
      return denominatorTotal === null || denominatorTotal === 0 ? (paired.length ? 0 : null) : numeratorTotal / denominatorTotal;
    }
  });
})(globalThis);
