// Thin client for the BorrowBox API. Every write carries an Idempotency-Key so a double click,
// a retry or a flaky connection never creates a duplicate.
export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || 'Something went wrong. Please try again.');
    this.status = status;
    this.code = error?.code;
    this.details = error?.details;
  }
}

async function call(method, path, body, { key } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: 'offline', message: "We couldn't reach BorrowBox. Check your connection and try again." });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('borrowbox:signed-out'));
    throw new ApiError(res.status, json?.error);
  }
  return json;
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const api = {
  config: () => call('GET', '/config'),
  people: () => call('GET', '/people'),
  session: () => call('GET', '/session'),
  signIn: (personId) => call('POST', '/session', { personId }),
  signOut: () => call('DELETE', '/session'),

  items: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null));
    return call('GET', `/items${q.toString() ? `?${q}` : ''}`);
  },
  item: (id) => call('GET', `/items/${encodeURIComponent(id)}`),
  createItem: (body, key) => call('POST', '/items', body, { key }),
  updateItem: (id, body, key) => call('PATCH', `/items/${id}`, body, { key }),
  setHidden: (id, hidden, key) => call('POST', `/items/${id}/visibility`, { hidden }, { key }),

  reservations: () => call('GET', '/reservations'),
  reservation: (id) => call('GET', `/reservations/${id}`),
  request: (itemId, body, key) => call('POST', `/items/${itemId}/requests`, body, { key }),
  act: (id, act, body, key) => call('POST', `/reservations/${id}/${act}`, body ?? {}, { key }),
  proposeExtension: (id, body, key) => call('POST', `/reservations/${id}/extensions`, body, { key }),
  answerExtension: (extId, act, body, key) => call('POST', `/extensions/${extId}/${act}`, body ?? {}, { key }),
};
