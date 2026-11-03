import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import PhotoPicker from '../components/PhotoPicker.jsx';
import AudiencePicker from '../components/AudiencePicker.jsx';
import { Button, ErrorState, FormError, Photo, Spinner, useSubmit } from '../components/ui.jsx';

const EMPTY = { title: '', category: '', description: '', lendingRules: '', maxLoanDays: 7, pickupArea: '' };

export default function ItemForm() {
  const { id } = useParams();
  const editing = !!id;
  const { config, toast, me } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [photo, setPhoto] = useState(null);
  const [existing, setExisting] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [audience, setAudience] = useState({ audience: 'everyone', circleIds: [] });
  const [myCircles, setMyCircles] = useState([]);
  const { busy, error, setError, run } = useSubmit();

  useEffect(() => {
    if (!editing) api.circles().then((c) => setMyCircles(c.circles)).catch(() => {});
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    api.item(id).then((item) => {
      if (!item.isMine) { setLoadError({ status: 403, message: 'Only the owner can edit this item.' }); return; }
      setExisting(item);
      setForm({ title: item.title, category: item.category, description: item.description, lendingRules: item.lendingRules, maxLoanDays: item.maxLoanDays, pickupArea: item.pickupArea });
    }).catch(setLoadError);
  }, [editing, id]);

  if (loadError) return <ErrorState error={loadError} />;
  if (editing && !existing) return <div className="center-pad"><Spinner label="Loading item" /></div>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldError = (name) => (error?.details?.field === name ? error.message : null);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setError({ message: 'Please add a title.', details: { field: 'title' } });
    if (!form.category) return setError({ message: 'Please choose a category.', details: { field: 'category' } });
    if (!editing && !photo) return setError({ message: 'A photo helps friends recognise it. Please add one.', details: { field: 'photo' } });
    if (!editing && audience.audience === 'circles' && audience.circleIds.length === 0) return setError({ message: 'Pick at least one circle to share it with.', details: { field: 'circleIds' } });
    const body = { ...form, maxLoanDays: Number(form.maxLoanDays), ...(photo ? { photo } : {}), ...(editing ? {} : audience) };
    const res = await run((key) => (editing ? api.updateItem(id, body, key) : api.createItem(body, key)));
    if (res) {
      toast(editing ? 'Saved.' : audience.audience === 'circles' ? 'Listed for your circles.' : 'Listed! Friends can now ask to borrow it.');
      navigate(`/items/${res.item.id}`);
    }
  };

  return (
    <div className="narrow">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/shelf">My shelf</Link> <span aria-hidden="true">/</span> <span>{editing ? 'Edit' : 'New item'}</span></nav>
      <h1 className="display">{editing ? `Edit ${existing.title}` : 'Lend something'}</h1>
      <p className="lead">{editing ? 'Changes apply straight away. Existing requests keep their dates.' : `A good photo and clear rules make it easy for friends to say yes, ${me.firstName}.`}</p>
      <form className="panel form" onSubmit={submit} noValidate>
        <div className="field">
          <span id="photo-l">Photo {!editing && <em className="req">required</em>}</span>
          {editing && !photo && <Photo src={existing.photoUrl} alt={existing.title} className="form-photo" />}
          <PhotoPicker single value={photo} onChange={setPhoto} label={editing ? 'Replace photo' : 'Add a photo'} />
          {fieldError('photo') && <p className="form-error">{fieldError('photo')}</p>}
        </div>
        <label className="field">
          <span>Title <em className="req">required</em></span>
          <input value={form.title} onChange={set('title')} maxLength={80} placeholder="e.g. Four-person tent" aria-invalid={!!fieldError('title')} />
        </label>
        <label className="field">
          <span>Category <em className="req">required</em></span>
          <select value={form.category} onChange={set('category')} aria-invalid={!!fieldError('category')}>
            <option value="">Choose one…</option>
            {(config?.categories ?? []).map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Description</span>
          <textarea rows={4} value={form.description} onChange={set('description')} maxLength={2000} placeholder="What is it, what comes with it, what's it good for?" />
        </label>
        <label className="field">
          <span>Lending rules</span>
          <textarea rows={4} value={form.lendingRules} onChange={set('lendingRules')} maxLength={1000} placeholder={'One per line, e.g.\nPlease return it clean\nNo use in the rain'} />
          <small className="muted">One rule per line. Friends see these before they ask.</small>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Longest loan (days)</span>
            <input type="number" min={1} max={90} value={form.maxLoanDays} onChange={set('maxLoanDays')} aria-invalid={!!fieldError('maxLoanDays')} />
          </label>
          <label className="field">
            <span>Pickup area</span>
            <input value={form.pickupArea} onChange={set('pickupArea')} maxLength={120} placeholder="e.g. Riverside, porch" />
          </label>
        </div>
        {!editing && <AudiencePicker value={audience} onChange={setAudience} circles={myCircles} idPrefix="new" />}
        <FormError error={error} />
        <div className="row-gap">
          <Button busy={busy}>{editing ? 'Save changes' : 'List it'}</Button>
          <Link className="btn btn-ghost" to={editing ? `/items/${id}` : '/shelf'}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
