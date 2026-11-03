// Refusals carry a stable code for clients and tests, and a calm human message for people.
export class Refusal extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthenticated = () => new Refusal(401, 'not_signed_in', 'Choose who you are first.');
export const forbidden = (message = "That isn't yours to do.") => new Refusal(403, 'forbidden', message);
export const notFound = (what = 'That') => new Refusal(404, 'not_found', `${what} couldn't be found.`);
export const conflict = (code, message, details) => new Refusal(409, code, message, details);
export const invalid = (message, details) => new Refusal(422, 'invalid', message, details);
