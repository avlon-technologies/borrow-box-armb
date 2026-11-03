import { useId } from 'react';
import { RATINGS } from '../format.js';
import PhotoPicker from './PhotoPicker.jsx';

/** One person's account of condition: a rating, words and photos. */
export default function ConditionForm({ value, onChange, legend = 'How does it look?', ratingRequired = true, allowDisagree = false, disagreeLabel, notePlaceholder }) {
  const id = useId();
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <div className="condition-form">
      <fieldset className="rating-group">
        <legend>{legend} {ratingRequired && <em className="req">required</em>}</legend>
        <div className="rating-options">
          {RATINGS.map((r) => (
            <label key={r.value} className={`rating-option ${value.rating === r.value ? 'on' : ''} rating-${r.value}`}>
              <input type="radio" name={`${id}-rating`} value={r.value} checked={value.rating === r.value} onChange={() => set('rating')(r.value)} />
              <strong>{r.label}</strong>
              <small>{r.hint}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {allowDisagree && (
        <label className="check">
          <input type="checkbox" checked={!!value.disagrees} onChange={(e) => set('disagrees')(e.target.checked)} />
          <span>{disagreeLabel}</span>
        </label>
      )}
      <label className="field">
        <span>Notes {value.disagrees ? <em className="req">required</em> : <em className="muted">(optional)</em>}</span>
        <textarea rows={3} maxLength={1000} value={value.note ?? ''} onChange={(e) => set('note')(e.target.value)} placeholder={notePlaceholder ?? 'Anything worth remembering — scratches, missing bits, how it worked.'} />
      </label>
      <PhotoPicker value={value.photos ?? []} onChange={set('photos')} />
    </div>
  );
}
