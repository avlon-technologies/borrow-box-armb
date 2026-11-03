import { useMemo, useState } from 'react';
import { addDays } from '../format.js';

const monthLabel = (y, m) => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m, 1)));
const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i))));
const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/**
 * Month calendar showing committed (busy) days. When `onPick` is given, days are buttons:
 * the first click picks the start, the second the end. Native date inputs remain the primary,
 * fully accessible way to choose dates; this is the visual companion.
 */
export default function Calendar({ today, busy = [], start, end, onPick, maxDays }) {
  const [offset, setOffset] = useState(0);
  const base = new Date(`${today}T00:00:00Z`);
  const months = [0, 1].map((k) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset + k, 1));
    return [d.getUTCFullYear(), d.getUTCMonth()];
  });
  const isBusy = useMemo(() => {
    const set = new Set();
    for (const b of busy) for (let d = b.start; d <= b.end; d = addDays(d, 1)) set.add(d);
    return (d) => set.has(d);
  }, [busy]);

  const click = (day) => {
    if (!onPick) return;
    if (!start || (start && end) || day < start) onPick(day, '');
    else onPick(start, day);
  };

  return (
    <div className="calendar">
      <div className="cal-nav">
        <button type="button" className="icon-button" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} aria-label="Previous month">‹</button>
        <button type="button" className="icon-button" onClick={() => setOffset((o) => Math.min(10, o + 1))} aria-label="Next month">›</button>
      </div>
      <div className="cal-months">
        {months.map(([y, m]) => {
          const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
          const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          return (
            <div className="cal-month" key={`${y}-${m}`}>
              <div className="cal-title">{monthLabel(y, m)}</div>
              <div className="cal-grid" role="grid" aria-label={monthLabel(y, m)}>
                {weekdays.map((w, i) => <span key={i} className="cal-wd" aria-hidden="true">{w}</span>)}
                {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
                {Array.from({ length: count }, (_, i) => {
                  const day = iso(y, m, i + 1);
                  const past = day < today;
                  const taken = isBusy(day);
                  const inRange = start && day >= start && day <= (end || start);
                  const tooLong = onPick && start && !end && maxDays && day > addDays(start, maxDays - 1);
                  const cls = ['cal-day', past && 'past', taken && 'busy', inRange && 'sel', day === start && 'sel-start', day === (end || start) && 'sel-end', day === today && 'today'].filter(Boolean).join(' ');
                  const label = `${new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })}${taken ? ', booked' : ''}${inRange ? ', selected' : ''}`;
                  return onPick ? (
                    <button key={day} type="button" className={cls} disabled={past || taken || tooLong} onClick={() => click(day)} aria-label={label} aria-pressed={!!inRange}>{i + 1}</button>
                  ) : (
                    <span key={day} className={cls} aria-label={label} role="gridcell">{i + 1}</span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="cal-legend" aria-hidden="true">
        <span><i className="lg lg-busy" /> Booked</span>
        <span><i className="lg lg-sel" /> Your dates</span>
        <span><i className="lg lg-today" /> Today</span>
      </div>
    </div>
  );
}
