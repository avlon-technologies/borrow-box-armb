import { Link } from 'react-router-dom';

/**
 * Who can borrow this: everybody, or only the owner's chosen circles. An item can also be
 * shared into circles while staying open to everybody, so it shows up on those circles' shelves.
 */
export default function AudiencePicker({ value, onChange, circles, idPrefix = 'aud', quietLegend = false }) {
  const { audience, circleIds } = value;
  const toggle = (id) => onChange({ audience, circleIds: circleIds.includes(id) ? circleIds.filter((x) => x !== id) : [...circleIds, id] });
  const noCircles = circles.length === 0;
  return (
    <fieldset className="audience">
      <legend className={quietLegend ? 'sr-only' : undefined}>Who can borrow it?</legend>
      <div className="audience-options">
        <label className={`audience-option ${audience === 'everyone' ? 'on' : ''}`}>
          <input type="radio" name={`${idPrefix}-audience`} value="everyone" checked={audience === 'everyone'} onChange={() => onChange({ audience: 'everyone', circleIds })} />
          <span className="audience-icon" aria-hidden="true">🌍</span>
          <span><strong>Everyone on BorrowBox</strong><small>Anyone can find it and ask.</small></span>
        </label>
        <label className={`audience-option ${audience === 'circles' ? 'on' : ''} ${noCircles ? 'is-disabled' : ''}`}>
          <input type="radio" name={`${idPrefix}-audience`} value="circles" disabled={noCircles} checked={audience === 'circles'} onChange={() => onChange({ audience: 'circles', circleIds })} />
          <span className="audience-icon" aria-hidden="true">🫶</span>
          <span><strong>Just my circles</strong><small>Only people in the circles you pick can see it.</small></span>
        </label>
      </div>
      {noCircles ? (
        <p className="muted small">You're not in any circles yet. <Link to="/circles">Start one</Link> to lend just to close friends.</p>
      ) : (
        <div className="audience-circles" role="group" aria-label={audience === 'circles' ? 'Share with these circles' : 'Also show it in these circles'}>
          <p className="small muted">{audience === 'circles' ? 'Share with:' : 'Also show it on these circle shelves (optional):'}</p>
          {circles.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={circleIds.includes(c.id)} onChange={() => toggle(c.id)} />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
