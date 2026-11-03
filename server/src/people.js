export function personView(row) {
  if (!row) return null;
  return { id: row.id, handle: row.handle, name: row.name, firstName: row.name.split(' ')[0], bio: row.bio, neighborhood: row.neighborhood, color: row.color };
}

export function getPerson(db, id) {
  return personView(db.prepare('SELECT * FROM people WHERE id = ?').get(id));
}

export function listPeople(db) {
  return db.prepare('SELECT * FROM people ORDER BY name').all().map(personView);
}
