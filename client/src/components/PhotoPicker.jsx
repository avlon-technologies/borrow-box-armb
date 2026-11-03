import { useId, useRef, useState } from 'react';

/** Resize in the browser so uploads stay small (long edge 1400px, JPEG). */
export async function resizeImage(file, maxEdge = 1400) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That image couldn't be opened."));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function PhotoPicker({ value, onChange, max = 4, label = 'Add photos', single = false }) {
  const id = useId();
  const input = useRef(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const photos = single ? (value ? [value] : []) : value;

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    setWorking(true);
    try {
      const room = single ? 1 : max - photos.length;
      const resized = await Promise.all(files.slice(0, room).map((f) => resizeImage(f)));
      onChange(single ? resized[0] : [...photos, ...resized]);
      if (files.length > room) setError(`Only ${max} photos fit — the rest were left out.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="photo-picker">
      {photos.length > 0 && (
        <ul className="thumbs">
          {photos.map((p, i) => (
            <li key={i} className="thumb">
              <img src={p} alt={`Photo ${i + 1}`} />
              <button type="button" className="thumb-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => onChange(single ? null : photos.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {(single || photos.length < max) && (
        <>
          <input ref={input} id={id} type="file" accept="image/*" multiple={!single} className="sr-only" onChange={pick} />
          <label htmlFor={id} className="btn btn-ghost photo-add" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}>
            📷 {working ? 'Preparing…' : single && photos.length ? 'Change photo' : label}
          </label>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
